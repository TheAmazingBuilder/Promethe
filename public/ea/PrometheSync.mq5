//+------------------------------------------------------------------+
//|                                          PrometheSync.mq5    |
//|   Promethe — read-only broker sync EA for MetaTrader 5       |
//+------------------------------------------------------------------+
//
//  IMPORTANT — READ FIRST
//  ────────────────────
//  * This EA must be COMPILED in MetaEditor (open the file, press F7).
//    It cannot run from source.
//  * Test it on a DEMO account first. It is one-way (broker → app) and
//    strictly read-only: it NEVER places, modifies or closes orders.
//  * Before it can send anything you must whitelist the app URL:
//      Tools → Options → Expert Advisors → "Allow WebRequest for listed URL"
//      → add your app's HTTPS base URL (e.g. https://your-app.example)
//    Without this, WebRequest fails with error 4060.
//  * Attach the EA to exactly ONE chart. It watches the WHOLE account.
//  * MetaTrader must stay running for live sync (a VPS is recommended).
//    Missed events are recovered from the terminal history on restart.
//
//  SETTINGS (Inputs)
//  ─────────────────
//  ApiUrl               — your Promethe ingest endpoint
//                         (https://…/api/ingest/mt)
//  ApiToken             — the token shown ONCE when creating the connection
//                         in Settings → Broker sync
//  HeartbeatMinutes     — heartbeat/equity cadence (default 5)
//  SendHistoryFromDate  — backfill closed positions since this date
//                         (0 = no backfill; the web app can also push a
//                         remote value via /ping)
//  DebugLog             — verbose Experts-tab logging
//
#property copyright "Promethe v3"
#property version   "1.0.0"
#property description "Read-only sync EA: sends trades/heartbeats to Promethe. Never trades."

input string   ApiUrl              = "https://your-app.example/api/ingest/mt";
input string   ApiToken            = "paste_your_token_here";
input int      HeartbeatMinutes    = 5;
input datetime SendHistoryFromDate = 0;   // 0 = no history backfill
input bool     DebugLog            = false;

// ── Constants ──────────────────────────────────────────────────────────────

#define PM_SCHEMA      1
#define PM_MAX_EVENTS  200
#define PM_STATE_FILE  "PrometheSync_state_%I64d.dat"
#define PM_OUTBOX_FILE "PrometheSync_outbox_%I64d.dat"

// ── MFE/MAE tracking state (survives restarts via the state file) ─────────

struct TrackPos
  {
   long   position_id;
   double mfe_price;     // best price seen while open (in profit direction)
   double mae_price;     // worst price seen while open
   long   first_seen;    // server time we first observed the position
   bool   complete;      // observed from (near) open to close
  };

TrackPos g_tracks[];
int      g_track_count = 0;

string   g_outbox      = "";    // pending event JSON lines (memory mirror)
int      g_backoff_s   = 5;     // current resend backoff (seconds)
datetime g_last_try    = 0;
bool     g_backfill_done = false;
datetime g_remote_backfill_from = 0;

// ── Small helpers ──────────────────────────────────────────────────────────

void Log(string message)
  {
   if(DebugLog) Print("[TJ] ", message);
  }

void LogErr(string message)
  {
   Print("[TJ][ERROR] ", message);
  }

/** Formats a double as a compact decimal string (no trailing zeros). */
string Num(double value)
  {
   string s = DoubleToString(value, 8);
   int    n = StringLen(s);
   while(n > 0 && StringSubstr(s, n - 1, 1) == "0") { n--; }
   if(n > 0 && StringSubstr(s, n - 1, 1) == ".") { n--; }
   s = StringSubstr(s, 0, n);
   if(s == "" || s == "-") s = "0";
   return s;
  }

string I64(long value) { return IntegerToString(value); }

/** Escapes a string for JSON. */
string JsonStr(string value)
  {
   string out = "";
   int    len = StringLen(value);
   for(int i = 0; i < len; i++)
     {
      ushort ch = StringGetCharacter(value, i);
      if(ch == '"')       out += "\\\"";
      else if(ch == '\\') out += "\\\\";
      else if(ch == '\n') out += "\\n";
      else if(ch == '\r') out += "\\r";
      else if(ch == '\t') out += "\\t";
      else if(ch < 32)    out += StringFormat("\\u%04x", ch);
      else                out += StringSubstr(value, i, 1);
     }
   return "\"" + out + "\"";
  }

/** Broker server GMT offset in SECONDS (server time − GMT). */
int ServerGmtOffsetSeconds()
  {
   long server = (long)TimeTradeServer();
   long gmt    = (long)TimeGMT();
   return (int)(server - gmt);
  }

string ServerName() { return AccountInfoString(ACCOUNT_SERVER); }
string LoginName() { return I64((long)AccountInfoInteger(ACCOUNT_LOGIN)); }

string StateFileName()  { return StringFormat(PM_STATE_FILE,  AccountInfoInteger(ACCOUNT_LOGIN)); }
string OutboxFileName() { return StringFormat(PM_OUTBOX_FILE, AccountInfoInteger(ACCOUNT_LOGIN)); }

// ── Event construction ─────────────────────────────────────────────────────

/** Stable eventId: platform:server:login:type:ticket */
string MakeEventId(string type, long ticket)
  {
   return "MT5:" + ServerName() + ":" + LoginName() + ":" + type + ":" + I64(ticket);
  }

void QueueEvent(string eventJson)
  {
   g_outbox += eventJson + "\n";
   AppendOutboxFile(eventJson);
   Log("queued event");
  }

/** Builds the payload envelope around up to PM_MAX_EVENTS queued events. */
string BuildPayload(string eventsJoined)
  {
   string s = "{";
   s += "\"schemaVersion\":" + I64(PM_SCHEMA) + ",";
   s += "\"platform\":\"MT5\",";
   s += "\"eaVersion\":\"1.0.0\",";
   s += "\"server\":"   + JsonStr(ServerName()) + ",";
   s += "\"login\":"    + JsonStr(LoginName()) + ",";
   s += "\"currency\":" + JsonStr(AccountInfoString(ACCOUNT_CURRENCY)) + ",";
   s += "\"leverage\":" + JsonStr(Num((double)AccountInfoInteger(ACCOUNT_LEVERAGE))) + ",";
   s += "\"serverGmtOffsetSeconds\":" + I64(ServerGmtOffsetSeconds()) + ",";
   s += "\"sentAt\":"  + I64((long)TimeTradeServer()) + ",";
   s += "\"events\":[" + eventsJoined + "]";
   s += "}";
   return s;
  }

// ── Outbox persistence (FILE_COMMON survives terminal restarts) ────────────

void AppendOutboxFile(string eventJson)
  {
   int handle = FileOpen(OutboxFileName(),
                         FILE_READ | FILE_WRITE | FILE_TXT | FILE_COMMON | FILE_ANSI);
   if(handle == INVALID_HANDLE) { LogErr("cannot open outbox: " + I64(GetLastError())); return; }
   FileSeek(handle, 0, SEEK_END);
   FileWriteString(handle, eventJson + "\n");
   FileClose(handle);
  }

int LoadOutbox()
  {
   g_outbox = "";
   if(!FileIsExist(OutboxFileName(), FILE_COMMON)) return 0;
   int handle = FileOpen(OutboxFileName(),
                         FILE_READ | FILE_TXT | FILE_COMMON | FILE_ANSI);
   if(handle == INVALID_HANDLE) return 0;
   while(!FileIsEnding(handle))
     {
      string line = FileReadString(handle);
      if(StringLen(line) > 2) g_outbox += line + "\n";
     }
   FileClose(handle);
   int count = 0;
   for(int i = 0; i < StringLen(g_outbox); i++)
      if(StringGetCharacter(g_outbox, i) == '\n') count++;
   return count;
  }

/** Rewrites the outbox file with what remains after a successful send. */
void PersistRemainingOutbox(int sentLines)
  {
   int handle = FileOpen(OutboxFileName(),
                         FILE_WRITE | FILE_TXT | FILE_COMMON | FILE_ANSI);
   if(handle == INVALID_HANDLE) return;
   int written = 0;
   int start = 0;
   int len = StringLen(g_outbox);
   for(int i = 0; i <= len; i++)
     {
      bool isNewline = (i < len && StringGetCharacter(g_outbox, i) == '\n');
      if(isNewline || i == len)
        {
         if(written >= sentLines)
           {
            string line = StringSubstr(g_outbox, start, i - start);
            if(StringLen(line) > 2) FileWriteString(handle, line + "\n");
           }
         written++;
         start = i + 1;
        }
     }
   FileClose(handle);
  }

// ── HTTP ───────────────────────────────────────────────────────────────────

/**
 * POSTs one payload with up to PM_MAX_EVENTS events. Returns true on 2xx.
 * ERROR 4060 means the URL is not whitelisted (see header instructions).
 */
bool PostPayload(string payload)
  {
   string headers = "Authorization: Bearer " + ApiToken + "\r\n" +
                    "Content-Type: application/json\r\n";
   char   post[], result[];
   string resultHeaders;
   StringToCharArray(payload, post, 0, StringLen(payload));
   int    status = WebRequest("POST", ApiUrl, headers, 10000, post, result, resultHeaders);
   if(status == -1)
     {
      int err = GetLastError();
      if(err == 4060 || err == 4014)
         LogErr("WebRequest blocked — add the app URL in Tools > Options > Expert Advisors (error " + I64(err) + ")");
      else
         LogErr("WebRequest failed, error " + I64(err));
      return false;
     }
   if(status < 200 || status >= 300)
     {
      LogErr("server returned HTTP " + I64(status) + ": " + CharArrayToString(result));
      return false;
     }
   Log("payload accepted (" + I64(status) + ")");
   return true;
  }

/** Sends /ping and applies the remote backfill window (best effort). */
void PingRemoteConfig()
  {
   string headers = "Authorization: Bearer " + ApiToken + "\r\n";
   char   post[], result[];
   string resultHeaders;
   string url = ApiUrl;
   if(StringSubstr(url, StringLen(url) - 4) == "/mt/") url = StringSubstr(url, 0, StringLen(url) - 1);
   if(StringSubstr(url, StringLen(url) - 3) == "/mt")  url = url + "/ping";
   int status = WebRequest("GET", url, headers, 10000, post, result, resultHeaders);
   if(status == 200)
     {
      string body = CharArrayToString(result);
      int pos = StringFind(body, "\"historyBackfillFrom\":");
      if(pos >= 0)
        {
         int  vstart = pos + 23;
         int  vend = vstart;
         while(vend < StringLen(body))
           {
            string ch = StringSubstr(body, vend, 1);
            if(ch == "," || ch == "}") break;
            vend++;
           }
         string value = StringSubstr(body, vstart, vend - vstart);
         StringTrimLeft(value); StringTrimRight(value);
         if(value != "null" && StringLen(value) > 0)
           {
            g_remote_backfill_from = (datetime)StringToInteger(value);
            Log("remote backfill from: " + TimeToString(g_remote_backfill_from));
           }
        }
     }
   else if(status == -1)
      LogErr("ping blocked — check the WebRequest whitelist (error " + I64(GetLastError()) + ")");
  }

/**
 * Attempts to flush the outbox to the server (batches of PM_MAX_EVENTS).
 * On success removes sent lines and resets the backoff; on failure keeps
 * them and applies exponential backoff.
 */
void FlushOutbox()
  {
   if(StringLen(g_outbox) < 3) return;
   datetime now = TimeCurrent();
   if(g_last_try > 0 && (long)(now - g_last_try) < (long)g_backoff_s) return;
   g_last_try = now;

   // Split into lines, batch them.
   string lines[];
   int    total = StringLen(g_outbox);
   int    start = 0;
   int    lineCount = 0;
   for(int i = 0; i <= total; i++)
     {
      bool isNewline = (i < total && StringGetCharacter(g_outbox, i) == '\n');
      if(isNewline || i == total)
        {
         int size = ArraySize(lines);
         ArrayResize(lines, size + 1);
         lines[size] = StringSubstr(g_outbox, start, i - start);
         lineCount++;
         start = i + 1;
        }
     }
   if(lineCount == 0) return;

   int sentTotal = 0;
   bool allOk = true;
   for(int batchStart = 0; batchStart < lineCount && allOk; batchStart += PM_MAX_EVENTS)
     {
      int   batchCount = MathMin(PM_MAX_EVENTS, lineCount - batchStart);
      string joined = "";
      for(int j = batchStart; j < batchStart + batchCount; j++)
        {
         if(j > batchStart) joined += ",";
         joined += lines[j];
        }
      if(PostPayload(BuildPayload(joined)))
         sentTotal += batchCount;
      else
        { allOk = false; break; }
     }

   if(sentTotal > 0)
     {
      // Remove the first sentTotal lines from g_outbox.
      int removed = 0;
      int seek = 0;
      int len = StringLen(g_outbox);
      while(removed < sentTotal && seek <= len)
        {
         if(seek < len && StringGetCharacter(g_outbox, seek) == '\n') removed++;
         seek++;
        }
      g_outbox = StringSubstr(g_outbox, seek);
      PersistRemainingOutbox(0);
      // Re-persist what remains (simplest: rewrite from memory).
      int handle = FileOpen(OutboxFileName(), FILE_WRITE | FILE_TXT | FILE_COMMON | FILE_ANSI);
      if(handle != INVALID_HANDLE)
        {
         FileWriteString(handle, g_outbox);
         FileClose(handle);
        }
     }

   if(allOk && sentTotal == lineCount)
     {
      g_backoff_s = 5;  // everything sent → reset backoff
      g_outbox = "";
     }
   else
     {
      g_backoff_s = MathMin(3600, g_backoff_s * 2);
      Log("flush postponed, backoff " + I64(g_backoff_s) + "s");
     }
  }

// ── MFE/MAE tracking ───────────────────────────────────────────────────────

int FindTrack(long positionId)
  {
   for(int i = 0; i < g_track_count; i++)
      if(g_tracks[i].position_id == positionId) return i;
   return -1;
  }

TrackPos MakeTrack(long positionId, double mfe, double mae, long seen, bool complete)
  {
   TrackPos t;
   t.position_id = positionId;
   t.mfe_price   = mfe;
   t.mae_price   = mae;
   t.first_seen  = seen;
   t.complete    = complete;
   return t;
  }

void SaveTrack(TrackPos &t)
  {
   int idx = FindTrack(t.position_id);
   if(idx >= 0) { g_tracks[idx] = t; return; }
   ArrayResize(g_tracks, g_track_count + 1);
   g_tracks[g_track_count] = t;
   g_track_count++;
  }

void RemoveTrack(long positionId)
  {
   int idx = FindTrack(positionId);
   if(idx < 0) return;
   for(int i = idx; i < g_track_count - 1; i++) g_tracks[i] = g_tracks[i + 1];
   g_track_count--;
   ArrayResize(g_tracks, g_track_count);
  }

/** Updates MFE/MAE for every open position using current prices. */
void ScanOpenPositions()
  {
   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      long   positionId = (long)PositionGetInteger(POSITION_IDENTIFIER);
      long   type       = PositionGetInteger(POSITION_TYPE);
      double bid = SymbolInfoDouble(PositionGetString(POSITION_SYMBOL), SYMBOL_BID);
      double ask = SymbolInfoDouble(PositionGetString(POSITION_SYMBOL), SYMBOL_ASK);
      // Favorable price for LONG = bid high ; for SHORT = ask low.
      double favorable = (type == POSITION_TYPE_BUY) ? bid : ask;
      double adverse   = (type == POSITION_TYPE_BUY) ? ask : bid;

      int idx = FindTrack(positionId);
      if(idx < 0)
        {
         TrackPos t = MakeTrack(positionId, favorable, adverse,
                                (long)TimeCurrent(), false);
         SaveTrack(t);
        }
      else
        {
         if(favorable > g_tracks[idx].mfe_price) g_tracks[idx].mfe_price = favorable;
         if(adverse   < g_tracks[idx].mae_price || g_tracks[idx].mae_price == 0)
            g_tracks[idx].mae_price = adverse;
        }
     }
  }

void LoadTracks()
  {
   g_track_count = 0;
   ArrayResize(g_tracks, 0);
   if(!FileIsExist(StateFileName(), FILE_COMMON)) return;
   int handle = FileOpen(StateFileName(), FILE_READ | FILE_TXT | FILE_COMMON | FILE_ANSI);
   if(handle == INVALID_HANDLE) return;
   while(!FileIsEnding(handle))
     {
      string line = FileReadString(handle);
      if(StringLen(line) < 5) continue;
      string parts[];
      if(StringSplit(line, ';', parts) < 5) continue;
      TrackPos t = MakeTrack((long)StringToInteger(parts[0]),
                             StringToDouble(parts[1]),
                             StringToDouble(parts[2]),
                             (long)StringToInteger(parts[3]),
                             parts[4] == "1");
      SaveTrack(t);
     }
   FileClose(handle);
  }

void SaveTracks()
  {
   int handle = FileOpen(StateFileName(), FILE_WRITE | FILE_TXT | FILE_COMMON | FILE_ANSI);
   if(handle == INVALID_HANDLE) return;
   for(int i = 0; i < g_track_count; i++)
     {
      FileWriteString(handle, I64(g_tracks[i].position_id) + ";" +
                               Num(g_tracks[i].mfe_price) + ";" +
                               Num(g_tracks[i].mae_price) + ";" +
                               I64(g_tracks[i].first_seen) + ";" +
                               (g_tracks[i].complete ? "1" : "0") + "\n");
     }
   FileClose(handle);
  }

/** True when the position was observed (almost) from its open time. */
bool TrackIsComplete(TrackPos &t, long openTime)
  {
   return (t.first_seen <= openTime + 120);
  }

// ── Event emitters ─────────────────────────────────────────────────────────

void SendHeartbeat()
  {
   string s = "{";
   s += "\"eventId\":" + JsonStr(MakeEventId("HB", (long)TimeTradeServer())) + ",";
   s += "\"type\":\"HEARTBEAT\",";
   s += "\"time\":" + I64((long)TimeTradeServer()) + ",";
   s += "\"balance\":" + JsonStr(Num(AccountInfoDouble(ACCOUNT_BALANCE))) + ",";
   s += "\"equity\":"  + JsonStr(Num(AccountInfoDouble(ACCOUNT_EQUITY))) + ",";
   s += "\"margin\":"  + JsonStr(Num(AccountInfoDouble(ACCOUNT_MARGIN))) + ",";
   s += "\"openPositions\":" + I64((long)PositionsTotal());
   s += "}";
   QueueEvent(s);
  }

void SendPositionOpened(long dealTicket, long positionId)
  {
   if(!HistoryDealSelect(dealTicket)) return;
   long   dealType  = HistoryDealGetInteger(dealTicket, DEAL_TYPE);
   string direction = (dealType == DEAL_TYPE_BUY) ? "LONG" : "SHORT";
   string symbol    = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
   double volume    = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
   double price     = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
   long   openTime  = (long)HistoryDealGetInteger(dealTicket, DEAL_TIME);
   long   magic     = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
   string comment   = HistoryDealGetString(dealTicket, DEAL_COMMENT);

   string s = "{";
   s += "\"eventId\":" + JsonStr(MakeEventId("OPEN", dealTicket)) + ",";
   s += "\"type\":\"POSITION_OPENED\",";
   s += "\"time\":" + I64(openTime) + ",";
   s += "\"symbol\":" + JsonStr(symbol) + ",";
   s += "\"symbolSpec\":" + SymbolSpecJson(symbol) + ",";
   s += "\"positionId\":" + JsonStr(I64(positionId)) + ",";
   s += "\"ticket\":" + JsonStr(I64(dealTicket)) + ",";
   s += "\"direction\":" + JsonStr(direction) + ",";
   s += "\"volume\":" + JsonStr(Num(volume)) + ",";
   s += "\"openTime\":" + I64(openTime) + ",";
   s += "\"openPrice\":" + JsonStr(Num(price)) + ",";
   s += "\"magic\":" + JsonStr(I64(magic)) + ",";
   s += "\"comment\":" + JsonStr(comment);
   s += "}";
   QueueEvent(s);
  }

string SymbolSpecJson(string symbol)
  {
   long   digits = SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double point  = SymbolInfoDouble(symbol, SYMBOL_POINT);
   double tsize  = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   double tvalue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
   double csize  = SymbolInfoDouble(symbol, SYMBOL_TRADE_CONTRACT_SIZE);
   return "{\"digits\":" + JsonStr(I64(digits)) + ","
          "\"point\":" + JsonStr(Num(point)) + ","
          "\"tickSize\":" + JsonStr(Num(tsize)) + ","
          "\"tickValue\":" + JsonStr(Num(tvalue)) + ","
          "\"contractSize\":" + JsonStr(Num(csize)) + "}";
  }

void SendPositionModified(long positionId, double sl, double tp)
  {
   string s = "{";
   s += "\"eventId\":" + JsonStr(MakeEventId("MOD", positionId) + ":" + I64((long)TimeTradeServer())) + ",";
   s += "\"type\":\"POSITION_MODIFIED\",";
   s += "\"time\":" + I64((long)TimeTradeServer()) + ",";
   s += "\"positionId\":" + JsonStr(I64(positionId)) + ",";
   s += "\"stopLoss\":" + JsonStr(Num(sl)) + ",";
   s += "\"takeProfit\":" + JsonStr(Num(tp));
   s += "}";
   QueueEvent(s);
  }

/**
 * Sends the close of a position (full or partial). The remaining volume is
 * computed from the position's deal history so the event is correct even
 * when several partial closes happen.
 */
void SendPositionClosed(long dealTicket, long positionId, bool partial)
  {
   if(!HistoryDealSelect(dealTicket)) return;

   // Aggregate the position's deals.
   if(!HistorySelectByPosition(positionId)) return;
   int    deals = HistoryDealsTotal();
   double volumeIn = 0, volumeOut = 0, profit = 0, commission = 0, swap = 0;
   long   openTime = 0, closeTime = 0;
   double openPrice = 0, closePrice = 0;
   string symbol = "", comment = "";
   long   magic = 0, firstDeal = 0, lastDeal = 0;
   long   directionDeal = -1;

   for(int i = 0; i < deals; i++)
     {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0) continue;
      long entry = HistoryDealGetInteger(deal, DEAL_ENTRY);
      double vol = HistoryDealGetDouble(deal, DEAL_VOLUME);
      long   t   = (long)HistoryDealGetInteger(deal, DEAL_TIME);
      if(firstDeal == 0) firstDeal = (long)deal;
      lastDeal = (long)deal;

      if(entry == DEAL_ENTRY_IN || entry == DEAL_ENTRY_INOUT)
        {
         volumeIn += vol;
         openTime = t;
         openPrice = HistoryDealGetDouble(deal, DEAL_PRICE);
         directionDeal = HistoryDealGetInteger(deal, DEAL_TYPE);
         symbol = HistoryDealGetString(deal, DEAL_SYMBOL);
         magic = HistoryDealGetInteger(deal, DEAL_MAGIC);
        }
      if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY || entry == DEAL_ENTRY_INOUT)
        {
         volumeOut += vol;
         closeTime = t;
         closePrice = HistoryDealGetDouble(deal, DEAL_PRICE);
         profit     += HistoryDealGetDouble(deal, DEAL_PROFIT);
         commission += HistoryDealGetDouble(deal, DEAL_COMMISSION);
         swap       += HistoryDealGetDouble(deal, DEAL_SWAP);
         comment = HistoryDealGetString(deal, DEAL_COMMENT);
        }
     }

   // Current SL/TP of the position (still queryable on a partial close).
   double sl = 0, tp = 0;
   if(PositionSelectByTicket((ulong)positionId))
     {
      sl = PositionGetDouble(POSITION_SL);
      tp = PositionGetDouble(POSITION_TP);
     }

   string direction = (directionDeal == DEAL_TYPE_BUY) ? "LONG" : "SHORT";
   int idx = FindTrack(positionId);
   double mfe = (idx >= 0) ? g_tracks[idx].mfe_price : 0;
   double mae = (idx >= 0) ? g_tracks[idx].mae_price : 0;
   bool complete = (idx >= 0) ? TrackIsComplete(g_tracks[idx], openTime) : false;

   if(partial)
     {
      string p = "{";
      p += "\"eventId\":" + JsonStr(MakeEventId("PCLOSE", dealTicket)) + ",";
      p += "\"type\":\"POSITION_PARTIAL_CLOSE\",";
      p += "\"time\":" + I64(closeTime) + ",";
      p += "\"positionId\":" + JsonStr(I64(positionId)) + ",";
      p += "\"closedVolume\":" + JsonStr(Num(HistoryDealGetDouble(dealTicket, DEAL_VOLUME))) + ",";
      p += "\"closeTime\":" + I64(closeTime) + ",";
      p += "\"closePrice\":" + JsonStr(Num(HistoryDealGetDouble(dealTicket, DEAL_PRICE))) + ",";
      p += "\"profit\":" + JsonStr(Num(HistoryDealGetDouble(dealTicket, DEAL_PROFIT))) + ",";
      p += "\"commission\":" + JsonStr(Num(HistoryDealGetDouble(dealTicket, DEAL_COMMISSION))) + ",";
      p += "\"swap\":" + JsonStr(Num(HistoryDealGetDouble(dealTicket, DEAL_SWAP)));
      p += "}";
      QueueEvent(p);
      if(idx >= 0) RemoveTrack(positionId);
      return;
     }

   string s = "{";
   s += "\"eventId\":" + JsonStr(MakeEventId("CLOSE", dealTicket)) + ",";
   s += "\"type\":\"POSITION_CLOSED\",";
   s += "\"time\":" + I64(closeTime) + ",";
   s += "\"symbol\":" + JsonStr(symbol) + ",";
   s += "\"symbolSpec\":" + SymbolSpecJson(symbol) + ",";
   s += "\"positionId\":" + JsonStr(I64(positionId)) + ",";
   s += "\"ticket\":" + JsonStr(I64(lastDeal)) + ",";
   s += "\"direction\":" + JsonStr(direction) + ",";
   s += "\"volume\":" + JsonStr(Num(volumeIn)) + ",";
   s += "\"openTime\":" + I64(openTime) + ",";
   s += "\"openPrice\":" + JsonStr(Num(openPrice)) + ",";
   s += "\"closeTime\":" + I64(closeTime) + ",";
   s += "\"closePrice\":" + JsonStr(Num(closePrice)) + ",";
   s += "\"stopLoss\":" + JsonStr(Num(sl)) + ",";
   s += "\"takeProfit\":" + JsonStr(Num(tp)) + ",";
   s += "\"commission\":" + JsonStr(Num(commission)) + ",";
   s += "\"swap\":" + JsonStr(Num(swap)) + ",";
   s += "\"fees\":\"0\",";
   s += "\"profit\":" + JsonStr(Num(profit)) + ",";
   s += "\"magic\":" + JsonStr(I64(magic)) + ",";
   s += "\"comment\":" + JsonStr(comment) + ",";
   s += "\"mfePrice\":" + JsonStr(Num(mfe)) + ",";
   s += "\"maePrice\":" + JsonStr(Num(mae)) + ",";
   s += "\"mfeMaeComplete\":" + (complete ? "true" : "false");
   s += "}";
   QueueEvent(s);
   if(idx >= 0) RemoveTrack(positionId);
  }

void SendBalanceOperation(long dealTicket)
  {
   if(!HistoryDealSelect(dealTicket)) return;
   double amount = HistoryDealGetDouble(dealTicket, DEAL_PROFIT);
   long   t      = (long)HistoryDealGetInteger(dealTicket, DEAL_TIME);
   long   dtype  = HistoryDealGetInteger(dealTicket, DEAL_TYPE);
   string kind   = (dtype == DEAL_TYPE_CREDIT) ? "CREDIT"
                 : (amount >= 0 ? "DEPOSIT" : "WITHDRAWAL");
   string s = "{";
   s += "\"eventId\":" + JsonStr(MakeEventId("BAL", dealTicket)) + ",";
   s += "\"type\":\"BALANCE_OPERATION\",";
   s += "\"time\":" + I64(t) + ",";
   s += "\"amount\":" + JsonStr(Num(amount)) + ",";
   s += "\"kind\":" + JsonStr(kind) + ",";
   s += "\"comment\":" + JsonStr(HistoryDealGetString(dealTicket, DEAL_COMMENT));
   s += "}";
   QueueEvent(s);
  }

// ── History backfill (HISTORY_BATCH, 100 trades per page) ──────────────────

void SendHistoryBackfill()
  {
   if(g_backfill_done) return;
   datetime from = SendHistoryFromDate;
   if(from == 0 && g_remote_backfill_from > 0) from = g_remote_backfill_from;
   if(from == 0) { g_backfill_done = true; return; }

   if(!HistorySelect(from, TimeCurrent() + 86400)) return;

   // Collect closed positions (a position id with at least one OUT deal).
   long  positionIds[];
   int   count = 0;
   int    deals = HistoryDealsTotal();
   for(int i = 0; i < deals; i++)
     {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0) continue;
      long entry = HistoryDealGetInteger(deal, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY && entry != DEAL_ENTRY_INOUT)
         continue;
      long positionId = HistoryDealGetInteger(deal, DEAL_POSITION_ID);
      if(positionId == 0) continue;
      bool seen = false;
      for(int j = 0; j < count; j++)
         if(positionIds[j] == positionId) { seen = true; break; }
      if(!seen)
        {
         ArrayResize(positionIds, count + 1);
         positionIds[count] = positionId;
         count++;
        }
     }

   int totalPages = (count + 99) / 100;
   if(totalPages == 0) { g_backfill_done = true; return; }

   for(int page = 0; page < totalPages; page++)
     {
      int start = page * 100;
      int n = MathMin(100, count - start);
      string trades = "";
      for(int k = 0; k < n; k++)
        {
         if(!HistorySelectByPosition(positionIds[start + k])) continue;
         if(k > 0) trades += ",";
         trades += HistoryPositionJson(positionIds[start + k]);
        }
      string s = "{";
      s += "\"eventId\":" + JsonStr(MakeEventId("HIST", positionIds[start])) + ",";
      s += "\"type\":\"HISTORY_BATCH\",";
      s += "\"time\":" + I64((long)TimeTradeServer()) + ",";
      s += "\"page\":" + I64(page + 1) + ",";
      s += "\"totalPages\":" + I64(totalPages) + ",";
      s += "\"trades\":[" + trades + "]";
      s += "}";
      QueueEvent(s);
     }

   g_backfill_done = true;
   Log("history backfill queued: " + I64(count) + " positions");
  }

/** One closed position as a HISTORY_BATCH trade entry. */
string HistoryPositionJson(long positionId)
  {
   int    deals = HistoryDealsTotal();
   double volumeIn = 0, profit = 0, commission = 0, swap = 0;
   long   openTime = 0, closeTime = 0;
   double openPrice = 0, closePrice = 0;
   string symbol = "", comment = "";
   long   magic = 0, directionDeal = -1, lastDeal = 0;

   for(int i = 0; i < deals; i++)
     {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0) continue;
      long   entry = HistoryDealGetInteger(deal, DEAL_ENTRY);
      double vol   = HistoryDealGetDouble(deal, DEAL_VOLUME);
      long   t     = (long)HistoryDealGetInteger(deal, DEAL_TIME);
      lastDeal = (long)deal;

      if(entry == DEAL_ENTRY_IN || entry == DEAL_ENTRY_INOUT)
        {
         volumeIn += vol;
         openTime = t;
         openPrice = HistoryDealGetDouble(deal, DEAL_PRICE);
         directionDeal = HistoryDealGetInteger(deal, DEAL_TYPE);
         symbol = HistoryDealGetString(deal, DEAL_SYMBOL);
         magic = HistoryDealGetInteger(deal, DEAL_MAGIC);
        }
      if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY || entry == DEAL_ENTRY_INOUT)
        {
         profit     += HistoryDealGetDouble(deal, DEAL_PROFIT);
         commission += HistoryDealGetDouble(deal, DEAL_COMMISSION);
         swap       += HistoryDealGetDouble(deal, DEAL_SWAP);
         closeTime = t;
         closePrice = HistoryDealGetDouble(deal, DEAL_PRICE);
         comment = HistoryDealGetString(deal, DEAL_COMMENT);
        }
     }

   string direction = (directionDeal == DEAL_TYPE_BUY) ? "LONG" : "SHORT";
   string s = "{";
   s += "\"positionId\":" + JsonStr(I64(positionId)) + ",";
   s += "\"ticket\":" + JsonStr(I64(lastDeal)) + ",";
   s += "\"symbol\":" + JsonStr(symbol) + ",";
   s += "\"symbolSpec\":" + SymbolSpecJson(symbol) + ",";
   s += "\"direction\":" + JsonStr(direction) + ",";
   s += "\"volume\":" + JsonStr(Num(volumeIn)) + ",";
   s += "\"openTime\":" + I64(openTime) + ",";
   s += "\"openPrice\":" + JsonStr(Num(openPrice)) + ",";
   s += "\"closeTime\":" + I64(closeTime) + ",";
   s += "\"closePrice\":" + JsonStr(Num(closePrice)) + ",";
   s += "\"commission\":" + JsonStr(Num(commission)) + ",";
   s += "\"swap\":" + JsonStr(Num(swap)) + ",";
   s += "\"fees\":\"0\",";
   s += "\"profit\":" + JsonStr(Num(profit)) + ",";
   s += "\"magic\":" + JsonStr(I64(magic)) + ",";
   s += "\"comment\":" + JsonStr(comment) + ",";
   s += "\"mfeMaeComplete\":false";
   s += "}";
   return s;
  }

// ── Missed-event reconciliation (SL/TP changes while offline) ───────────────

void DetectPositionChanges()
  {
   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      long positionId = PositionGetInteger(POSITION_IDENTIFIER);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);

      // State file line format: "P;<positionId>;<sl>;<tp>"
      string key = "P;" + I64(positionId);
      string line = ReadStateLine(key);
      if(line == "")
        {
         WriteStateLine(key + ";" + Num(sl) + ";" + Num(tp));
        }
      else
        {
         string parts[];
         if(StringSplit(line, ';', parts) >= 4)
           {
            if(parts[2] != Num(sl) || parts[3] != Num(tp))
              {
               SendPositionModified(positionId, sl, tp);
               WriteStateLine(key + ";" + Num(sl) + ";" + Num(tp));
              }
           }
        }
     }
  }

string ReadStateLine(string key)
  {
   if(!FileIsExist(OutboxStateName(), FILE_COMMON)) return "";
   int handle = FileOpen(OutboxStateName(), FILE_READ | FILE_TXT | FILE_COMMON | FILE_ANSI);
   if(handle == INVALID_HANDLE) return "";
   string result = "";
   while(!FileIsEnding(handle))
     {
      string line = FileReadString(handle);
      if(StringFind(line, key + ";") == 0) { result = line; break; }
     }
   FileClose(handle);
   return result;
  }

string OutboxStateName()
  {
   return StringFormat("PrometheSync_pos_%I64d.dat", AccountInfoInteger(ACCOUNT_LOGIN));
  }

void WriteStateLine(string line)
  {
   // Rewrite the file keeping other keys, replacing this key's line.
   string key = StringSubstr(line, 0, StringFind(line, ";", StringFind(line, ";") + 1));
   // (key = first two fields, e.g. "P;12345")
   string all = "";
   if(FileIsExist(OutboxStateName(), FILE_COMMON))
     {
      int h = FileOpen(OutboxStateName(), FILE_READ | FILE_TXT | FILE_COMMON | FILE_ANSI);
      if(h != INVALID_HANDLE)
        {
         while(!FileIsEnding(h))
           {
            string l = FileReadString(h);
            if(StringLen(l) > 2 && StringFind(l, key + ";") != 0 && StringFind(l, key) != 0)
               all += l + "\n";
            else if(StringLen(l) > 2 && StringSubstr(l, 0, StringLen(key)) == key && StringFind(l, key + ";") != 0)
               all += l + "\n";
            else if(StringLen(l) > 2 && StringSubstr(l, 0, StringLen(key)) == key)
               { /* replaced */ }
           }
         FileClose(h);
        }
     }
   int handle = FileOpen(OutboxStateName(), FILE_WRITE | FILE_TXT | FILE_COMMON | FILE_ANSI);
   if(handle == INVALID_HANDLE) return;
   FileWriteString(handle, all + line + "\n");
   FileClose(handle);
  }

// ── MT5 entry points ───────────────────────────────────────────────────────

int OnInit()
  {
   if(StringLen(ApiToken) < 8 || StringFind(ApiToken, "paste") > 0)
     {
      LogErr("ApiToken is not set — create a connection in Promethe settings and paste the token.");
      return INIT_SUCCEEDED; // stay attached but idle
     }
   if(StringFind(ApiUrl, "https://") != 0)
      LogErr("ApiUrl must be HTTPS (WebRequest requirement).");

   LoadOutbox();
   LoadTracks();
   PingRemoteConfig();
   SendHeartbeat();
   SendHistoryBackfill();
   ScanOpenPositions();
   DetectPositionChanges();
   EventSetTimer(MathMax(30, HeartbeatMinutes * 60));
   Log("initialized — server " + ServerName() + " login " + LoginName());
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   SaveTracks();
   FlushOutbox();
  }

void OnTimer()
  {
   ScanOpenPositions();
   SaveTracks();
   DetectPositionChanges();
   SendHeartbeat();
   FlushOutbox();
  }

void OnTick()
  {
   // Fast MFE/MAE for the attached chart's symbol positions.
   ScanOpenPositions();
  }

void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
  {
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;

   if(!HistoryDealSelect(trans.deal)) return;
   long dealType  = HistoryDealGetInteger(trans.deal, DEAL_TYPE);

   // Balance / credit operations arrive as deals without a position.
   if(dealType == DEAL_TYPE_BALANCE || dealType == DEAL_TYPE_CREDIT)
     {
      SendBalanceOperation((long)trans.deal);
      FlushOutbox();
      return;
     }

   long positionId = HistoryDealGetInteger(trans.deal, DEAL_POSITION_ID);
   if(positionId == 0) return;
   long entry = HistoryDealGetInteger(trans.deal, DEAL_ENTRY);

   if(entry == DEAL_ENTRY_IN)
     {
      SendPositionOpened((long)trans.deal, positionId);
     }
   else if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY)
     {
      // Partial when the position still holds volume afterwards.
      bool partial = false;
      if(PositionSelectByTicket((ulong)positionId))
         partial = (PositionGetDouble(POSITION_VOLUME) > 0.0000001);
      SendPositionClosed((long)trans.deal, positionId, partial);
     }
   else if(entry == DEAL_ENTRY_INOUT)
     {
      // Netting reversal: close of the old side + open of the new side.
      SendPositionClosed((long)trans.deal, positionId, false);
      SendPositionOpened((long)trans.deal, HistoryDealGetInteger(trans.deal, DEAL_POSITION_ID));
     }

   FlushOutbox();
  }
//+------------------------------------------------------------------+
