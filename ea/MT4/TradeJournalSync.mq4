//+------------------------------------------------------------------+
//|                                          TradeJournalSync.mq4    |
//|   TradeJournal — read-only broker sync EA for MetaTrader 4       |
//+------------------------------------------------------------------+
//
//  IMPORTANT — READ FIRST
//  ────────────────────
//  * Compile in MetaEditor (F7). Test on a DEMO account first.
//  * Read-only and one-way (broker → app): this EA NEVER places,
//    modifies or closes orders.
//  * Whitelist the app URL before anything can be sent:
//      Tools → Options → Expert Advisors → "Allow WebRequest for listed URL"
//      → add your app's HTTPS base URL. Error 4060 = not whitelisted.
//  * Attach to ONE chart — the EA scans the whole account.
//  * MT4 specifics handled here:
//      - a partial close creates a NEW ticket for the remainder, whose
//        comment references the original ("from #123") — chains are
//        stitched into a single trade;
//      - state is diffed on a timer against the order pool + history.
//
#property copyright "TradeJournal v3"
#property link      "https://tradejournal.local"
#property version   "1.0.0"
#property strict
#property description "Read-only sync EA: sends trades/heartbeats to TradeJournal. Never trades."

input string   ApiUrl              = "https://your-app.example/api/ingest/mt";
input string   ApiToken            = "tj_paste_your_token_here";
input int      HeartbeatMinutes    = 5;      // heartbeat cadence
input datetime SendHistoryFromDate = 0;      // 0 = no backfill
input bool     DebugLog            = false;

#define TJ_SCHEMA      1
#define TJ_MAX_EVENTS  200

// ── Helpers ────────────────────────────────────────────────────────────────

void Log(string message)  { if(DebugLog) Print("[TJ] ", message); }
void LogErr(string message) { Print("[TJ][ERROR] ", message); }

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

string I64(int value) { return IntegerToString(value); }

string JsonStr(string value)
  {
   string out = "";
   for(int i = 0; i < StringLen(value); i++)
     {
      string ch = StringSubstr(value, i, 1);
      if(ch == "\"")       out += "\\\"";
      else if(ch == "\\")  out += "\\\\";
      else if(ch == "\n")  out += "\\n";
      else if(ch == "\r")  out += "\\r";
      else if(ch == "\t")  out += "\\t";
      else                 out += ch;
     }
   return "\"" + out + "\"";
  }

// MT4: server time − GMT (server clock is what the app needs).
int ServerGmtOffsetSeconds()
  {
   return (int)(TimeCurrent() - TimeGMT());
  }

string ServerName() { return AccountServer(); }
string LoginName()  { return I64(AccountNumber()); }

string StateFileName()  { return "TradeJournalSync_mq4_state_" + LoginName() + ".dat"; }
string OutboxFileName() { return "TradeJournalSync_mq4_outbox_" + LoginName() + ".dat"; }

string MakeEventId(string type, int ticket)
  {
   return "MT4:" + ServerName() + ":" + LoginName() + ":" + type + ":" + I64(ticket);
  }

// ── Outbox (FILE_COMMON survives restarts) ────────────────────────────────

string g_outbox = "";

void AppendOutboxFile(string eventJson)
  {
   int handle = FileOpen(OutboxFileName(), FILE_READ | FILE_WRITE | FILE_TXT | FILE_COMMON);
   if(handle == INVALID_HANDLE) { LogErr("cannot open outbox: " + I64(GetLastError())); return; }
   FileSeek(handle, 0, SEEK_END);
   FileWriteString(handle, eventJson + "\n");
   FileClose(handle);
  }

void LoadOutbox()
  {
   g_outbox = "";
   if(!FileIsExist(OutboxFileName(), FILE_COMMON)) return;
   int handle = FileOpen(OutboxFileName(), FILE_READ | FILE_TXT | FILE_COMMON);
   if(handle == INVALID_HANDLE) return;
   while(!FileIsEnding(handle))
     {
      string line = FileReadString(handle);
      if(StringLen(line) > 2) g_outbox += line + "\n";
     }
   FileClose(handle);
  }

void PersistOutboxFromMemory()
  {
   int handle = FileOpen(OutboxFileName(), FILE_WRITE | FILE_TXT | FILE_COMMON);
   if(handle == INVALID_HANDLE) return;
   FileWriteString(handle, g_outbox);
   FileClose(handle);
  }

void QueueEvent(string eventJson)
  {
   g_outbox += eventJson + "\n";
   AppendOutboxFile(eventJson);
   Log("queued event");
  }

// ── HTTP ───────────────────────────────────────────────────────────────────

bool PostPayload(string payload)
  {
   string headers = "Authorization: Bearer " + ApiToken + "\r\n" +
                    "Content-Type: application/json\r\n";
   char   post[], result[];
   string resultHeaders;
   StringToCharArray(payload, post, 0, StringLen(payload));
   int status = WebRequest("POST", ApiUrl, headers, 10000, post, result, resultHeaders);
   if(status == -1)
     {
      int err = GetLastError();
      if(err == 4060)
         LogErr("WebRequest blocked — add the app URL in Tools > Options > Expert Advisors (error 4060)");
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

int g_backoff_s = 5;
datetime g_last_try = 0;

void FlushOutbox()
  {
   if(StringLen(g_outbox) < 3) return;
   if(g_last_try > 0 && (TimeCurrent() - g_last_try) < g_backoff_s) return;
   g_last_try = TimeCurrent();

   string lines[];
   int    count = 0;
   int    total = StringLen(g_outbox);
   int    start = 0;
   for(int i = 0; i <= total; i++)
     {
      if((i < total && StringGetCharacter(g_outbox, i) == '\n') || i == total)
        {
         ArrayResize(lines, count + 1);
         lines[count] = StringSubstr(g_outbox, start, i - start);
         count++;
         start = i + 1;
        }
     }
   if(count == 0) return;

   int sent = 0;
   bool ok = true;
   for(int b = 0; b < count && ok; b += TJ_MAX_EVENTS)
     {
      int   n = MathMin(TJ_MAX_EVENTS, count - b);
      string events = "";
      for(int j = b; j < b + n; j++)
        {
         if(j > b) events += ",";
         events += lines[j];
        }
      string payload = "{";
      payload += "\"schemaVersion\":" + I64(TJ_SCHEMA) + ",";
      payload += "\"platform\":\"MT4\",";
      payload += "\"eaVersion\":\"1.0.0\",";
      payload += "\"server\":" + JsonStr(ServerName()) + ",";
      payload += "\"login\":" + JsonStr(LoginName()) + ",";
      payload += "\"currency\":" + JsonStr(AccountCurrency()) + ",";
      payload += "\"leverage\":" + JsonStr(Num(AccountLeverage())) + ",";
      payload += "\"serverGmtOffsetSeconds\":" + I64(ServerGmtOffsetSeconds()) + ",";
      payload += "\"sentAt\":" + I64((int)TimeCurrent()) + ",";
      payload += "\"events\":[" + events + "]";
      payload += "}";
      if(PostPayload(payload)) sent += n;
      else { ok = false; }
     }

   if(sent > 0)
     {
      int removed = 0, seek = 0, len = StringLen(g_outbox);
      while(removed < sent && seek <= len)
        {
         if(seek < len && StringGetCharacter(g_outbox, seek) == '\n') removed++;
         seek++;
        }
      g_outbox = StringSubstr(g_outbox, seek);
      PersistOutboxFromMemory();
     }
   if(ok && sent == count) { g_backoff_s = 5; }
   else { g_backoff_s = MathMin(3600, g_backoff_s * 2); Log("flush postponed, backoff " + I64(g_backoff_s) + "s"); }
  }

// ── Symbol spec ────────────────────────────────────────────────────────────

string SymbolSpecJson(string symbol)
  {
   return "{\"digits\":" + JsonStr(I64((int)MarketInfo(symbol, MODE_DIGITS))) + ","
          "\"point\":" + JsonStr(Num(MarketInfo(symbol, MODE_POINT))) + ","
          "\"tickSize\":" + JsonStr(Num(MarketInfo(symbol, MODE_TICKSIZE))) + ","
          "\"tickValue\":" + JsonStr(Num(MarketInfo(symbol, MODE_TICKVALUE))) + ","
          "\"contractSize\":" + JsonStr(Num(MarketInfo(symbol, MODE_LOTSIZE))) + "}";
  }

// ── Events ─────────────────────────────────────────────────────────────────

void SendHeartbeat()
  {
   string s = "{";
   s += "\"eventId\":" + JsonStr(MakeEventId("HB", (int)TimeCurrent())) + ",";
   s += "\"type\":\"HEARTBEAT\",";
   s += "\"time\":" + I64((int)TimeCurrent()) + ",";
   s += "\"balance\":" + JsonStr(Num(AccountBalance())) + ",";
   s += "\"equity\":" + JsonStr(Num(AccountEquity())) + ",";
   s += "\"margin\":" + JsonStr(Num(AccountMargin())) + ",";
   s += "\"openOrders\":" + I64(OrdersTotal());
   s += "}";
   QueueEvent(s);
  }

/**
 * Emits POSITION_OPENED for a new open order. positionId = the chain head
 * ticket (the order's own ticket unless it continues a partial-close chain,
 * in which case the referenced original is used).
 */
void SendOrderOpened(int ticket, string chainHead)
  {
   if(!OrderSelect(ticket, SELECT_BY_TICKET)) return;
   string direction = (OrderType() == OP_BUY) ? "LONG" : "SHORT";
   string s = "{";
   s += "\"eventId\":" + JsonStr(MakeEventId("OPEN", ticket)) + ",";
   s += "\"type\":\"POSITION_OPENED\",";
   s += "\"time\":" + I64((int)OrderOpenTime()) + ",";
   s += "\"symbol\":" + JsonStr(OrderSymbol()) + ",";
   s += "\"symbolSpec\":" + SymbolSpecJson(OrderSymbol()) + ",";
   s += "\"positionId\":" + JsonStr(chainHead) + ",";
   s += "\"ticket\":" + JsonStr(I64(ticket)) + ",";
   s += "\"direction\":" + JsonStr(direction) + ",";
   s += "\"volume\":" + JsonStr(Num(OrderLots())) + ",";
   s += "\"openTime\":" + I64((int)OrderOpenTime()) + ",";
   s += "\"openPrice\":" + JsonStr(Num(OrderOpenPrice())) + ",";
   s += "\"stopLoss\":" + JsonStr(Num(OrderStopLoss())) + ",";
   s += "\"takeProfit\":" + JsonStr(Num(OrderTakeProfit())) + ",";
   s += "\"magic\":" + JsonStr(I64(OrderMagicNumber())) + ",";
   s += "\"comment\":" + JsonStr(OrderComment());
   s += "}";
   QueueEvent(s);
  }

void SendOrderModified(int ticket)
  {
   if(!OrderSelect(ticket, SELECT_BY_TICKET)) return;
   string s = "{";
   s += "\"eventId\":" + JsonStr(MakeEventId("MOD", ticket) + ":" + I64((int)TimeCurrent())) + ",";
   s += "\"type\":\"POSITION_MODIFIED\",";
   s += "\"time\":" + I64((int)TimeCurrent()) + ",";
   s += "\"positionId\":" + JsonStr(I64(ticket)) + ",";
   s += "\"stopLoss\":" + JsonStr(Num(OrderStopLoss())) + ",";
   s += "\"takeProfit\":" + JsonStr(Num(OrderTakeProfit()));
   s += "}";
   QueueEvent(s);
  }

void SendOrderClosed(int ticket)
  {
   if(!OrderSelect(ticket, SELECT_BY_TICKET)) return;
   string direction = (OrderType() == OP_BUY) ? "LONG" : "SHORT";
   string s = "{";
   s += "\"eventId\":" + JsonStr(MakeEventId("CLOSE", ticket)) + ",";
   s += "\"type\":\"POSITION_CLOSED\",";
   s += "\"time\":" + I64((int)OrderCloseTime()) + ",";
   s += "\"symbol\":" + JsonStr(OrderSymbol()) + ",";
   s += "\"symbolSpec\":" + SymbolSpecJson(OrderSymbol()) + ",";
   s += "\"positionId\":" + JsonStr(I64(ticket)) + ",";
   s += "\"ticket\":" + JsonStr(I64(ticket)) + ",";
   s += "\"direction\":" + JsonStr(direction) + ",";
   s += "\"volume\":" + JsonStr(Num(OrderLots())) + ",";
   s += "\"openTime\":" + I64((int)OrderOpenTime()) + ",";
   s += "\"openPrice\":" + JsonStr(Num(OrderOpenPrice())) + ",";
   s += "\"closeTime\":" + I64((int)OrderCloseTime()) + ",";
   s += "\"closePrice\":" + JsonStr(Num(OrderClosePrice())) + ",";
   s += "\"stopLoss\":" + JsonStr(Num(OrderStopLoss())) + ",";
   s += "\"takeProfit\":" + JsonStr(Num(OrderTakeProfit())) + ",";
   s += "\"commission\":" + JsonStr(Num(OrderCommission())) + ",";
   s += "\"swap\":" + JsonStr(Num(OrderSwap())) + ",";
   s += "\"fees\":\"0\",";
   s += "\"profit\":" + JsonStr(Num(OrderProfit())) + ",";
   s += "\"magic\":" + JsonStr(I64(OrderMagicNumber())) + ",";
   s += "\"comment\":" + JsonStr(OrderComment()) + ",";
   s += "\"mfeMaeComplete\":false";
   s += "}";
   QueueEvent(s);
  }

/** Partial close of `ticket` for `closedLots` at price. */
void SendPartialClose(int ticket, double closedLots)
  {
   if(!OrderSelect(ticket, SELECT_BY_TICKET)) return;
   string s = "{";
   s += "\"eventId\":" + JsonStr(MakeEventId("PCLOSE", ticket) + ":" + I64((int)OrderCloseTime())) + ",";
   s += "\"type\":\"POSITION_PARTIAL_CLOSE\",";
   s += "\"time\":" + I64((int)OrderCloseTime()) + ",";
   s += "\"positionId\":" + JsonStr(I64(ticket)) + ",";
   s += "\"closedVolume\":" + JsonStr(Num(closedLots)) + ",";
   s += "\"closeTime\":" + I64((int)OrderCloseTime()) + ",";
   s += "\"closePrice\":" + JsonStr(Num(OrderClosePrice())) + ",";
   s += "\"profit\":" + JsonStr(Num(OrderProfit())) + ",";
   s += "\"commission\":" + JsonStr(Num(OrderCommission())) + ",";
   s += "\"swap\":" + JsonStr(Num(OrderSwap()));
   s += "}";
   QueueEvent(s);
  }

void SendBalanceOperation(int ticket)
  {
   if(!OrderSelect(ticket, SELECT_BY_TICKET)) return;
   double amount = OrderProfit();
   string kind = (OrderType() == 7) ? "CREDIT" : (amount >= 0 ? "DEPOSIT" : "WITHDRAWAL");
   string s = "{";
   s += "\"eventId\":" + JsonStr(MakeEventId("BAL", ticket)) + ",";
   s += "\"type\":\"BALANCE_OPERATION\",";
   s += "\"time\":" + I64((int)OrderCloseTime()) + ",";
   s += "\"amount\":" + JsonStr(Num(amount)) + ",";
   s += "\"kind\":" + JsonStr(kind) + ",";
   s += "\"comment\":" + JsonStr(OrderComment());
   s += "}";
   QueueEvent(s);
  }

// ── Known-order state (diff source), persisted ─────────────────────────────

/** Line format: "O;<ticket>;<lots>;<sl>;<tp>" — one per open market order. */
string KnownOrdersText()
  {
   if(!FileIsExist(StateFileName(), FILE_COMMON)) return "";
   int handle = FileOpen(StateFileName(), FILE_READ | FILE_TXT | FILE_COMMON);
   if(handle == INVALID_HANDLE) return "";
   string all = "";
   while(!FileIsEnding(handle)) all += FileReadString(handle) + "\n";
   FileClose(handle);
   return all;
  }

void SaveKnownOrdersText(string text)
  {
   int handle = FileOpen(StateFileName(), FILE_WRITE | FILE_TXT | FILE_COMMON);
   if(handle == INVALID_HANDLE) return;
   FileWriteString(handle, text);
   FileClose(handle);
  }

string OrderStateLine(int ticket)
  {
   if(!OrderSelect(ticket, SELECT_BY_TICKET)) return "";
   return "O;" + I64(ticket) + ";" + Num(OrderLots()) + ";" +
          Num(OrderStopLoss()) + ";" + Num(OrderTakeProfit()) + ";" +
          I64((int)OrderOpenTime()) + ";" + I64((int)OrderCloseTime());
  }

bool IsKnown(string known, int ticket)
  {
   return (StringFind(known, "O;" + I64(ticket) + ";") >= 0);
  }

/** Reads the stored lots for a known order (for partial-close detection). */
double KnownLots(string known, int ticket)
  {
   int pos = StringFind(known, "O;" + I64(ticket) + ";");
   if(pos < 0) return 0;
   string rest = StringSubstr(known, pos);
   string parts[];
   if(StringSplit(rest, ';', parts) < 3) return 0;
   return StringToDouble(parts[2]);
  }

// ── Scan & diff ────────────────────────────────────────────────────────────

/**
 * Resolves the chain head for an MT4 ticket by following "from #N" comments
 * in the open pool (partial close remainders point at their original).
 */
string ChainHeadFor(int ticket, string comment)
  {
   int from = StringFind(comment, "from #");
   if(from >= 0)
     {
      string ref = StringSubstr(comment, from + 6);
      string digits = "";
      for(int i = 0; i < StringLen(ref); i++)
        {
         string ch = StringSubstr(ref, i, 1);
         if(ch >= "0" && ch <= "9") digits += ch;
         else break;
        }
      if(StringLen(digits) > 0) return digits;
     }
   return I64(ticket);
  }

void Scan()
  {
   string known = KnownOrdersText();
   string fresh = "";

   // ── Open pool: new orders, SL/TP changes, partial closes ──
   for(int i = 0; i < OrdersTotal(); i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue; // market orders only

      int    ticket = OrderTicket();
      string line = OrderStateLine(ticket);
      double knownLots = KnownLots(known, ticket);

      if(!IsKnown(known, ticket))
        {
         string head = ChainHeadFor(ticket, OrderComment());
         SendOrderOpened(ticket, head);
        }
      else if(knownLots > 0 && knownLots > OrderLots() + 0.0000001)
        {
         // Volume shrank while the ticket stayed open → MT4 partial close.
         SendPartialClose(ticket, knownLots - OrderLots());
        }
      else
        {
         // Detect SL/TP modification by comparing stored line.
         int pos = StringFind(known, "O;" + I64(ticket) + ";");
         if(pos >= 0)
           {
            string rest = StringSubstr(known, pos);
            string stored = StringSubstr(rest, 0, StringFind(rest, "\n"));
            if(stored != line && StringLen(stored) > 5)
               SendOrderModified(ticket);
           }
        }
      fresh += line + "\n";
     }

   // ── History pool: tickets that vanished from the open pool ──
   int histTotal = OrdersHistoryTotal();
   for(int h = 0; h < histTotal; h++)
     {
      if(!OrderSelect(h, SELECT_BY_POS, MODE_HISTORY)) continue;
      int type = OrderType();

      // Balance / credit entries (types 6 / 7).
      if(type == 6 || type == 7)
        {
         // Only emit once: track last processed balance ticket by time gate.
         if(TimeCurrent() - OrderCloseTime() < (int)(HeartbeatMinutes * 60 * 4))
            SendBalanceOperation(OrderTicket());
         continue;
        }
      if(type != OP_BUY && type != OP_SELL) continue;

      int ticket = OrderTicket();
      if(IsKnown(known, ticket))
        {
         // Was open, now in history → closed (fully; partials keep the
         // remainder ticket open and were handled above).
         SendOrderClosed(ticket);
        }
     }

   SaveKnownOrdersText(fresh);
  }

// ── History backfill ───────────────────────────────────────────────────────

void SendHistoryBackfill()
  {
   datetime from = SendHistoryFromDate;
   if(from == 0) return;

   int    tickets[];
   int    count = 0;
   int    histTotal = OrdersHistoryTotal();
   for(int h = 0; h < histTotal; h++)
     {
      if(!OrderSelect(h, SELECT_BY_POS, MODE_HISTORY)) continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;
      if(OrderCloseTime() < from) continue;
      ArrayResize(tickets, count + 1);
      tickets[count] = OrderTicket();
      count++;
     }

   int totalPages = (count + 99) / 100;
   for(int page = 0; page < totalPages; page++)
     {
      int start = page * 100;
      int n = MathMin(100, count - start);
      string trades = "";
      for(int k = 0; k < n; k++)
        {
         if(!OrderSelect(tickets[start + k], SELECT_BY_TICKET)) continue;
         string head = ChainHeadFor(tickets[start + k], OrderComment());
         if(k > 0) trades += ",";
         string direction = (OrderType() == OP_BUY) ? "LONG" : "SHORT";
         trades += "{";
         trades += "\"positionId\":" + JsonStr(head) + ",";
         trades += "\"ticket\":" + JsonStr(I64(OrderTicket())) + ",";
         trades += "\"symbol\":" + JsonStr(OrderSymbol()) + ",";
         trades += "\"symbolSpec\":" + SymbolSpecJson(OrderSymbol()) + ",";
         trades += "\"direction\":" + JsonStr(direction) + ",";
         trades += "\"volume\":" + JsonStr(Num(OrderLots())) + ",";
         trades += "\"openTime\":" + I64((int)OrderOpenTime()) + ",";
         trades += "\"openPrice\":" + JsonStr(Num(OrderOpenPrice())) + ",";
         trades += "\"closeTime\":" + I64((int)OrderCloseTime()) + ",";
         trades += "\"closePrice\":" + JsonStr(Num(OrderClosePrice())) + ",";
         trades += "\"commission\":" + JsonStr(Num(OrderCommission())) + ",";
         trades += "\"swap\":" + JsonStr(Num(OrderSwap())) + ",";
         trades += "\"fees\":\"0\",";
         trades += "\"profit\":" + JsonStr(Num(OrderProfit())) + ",";
         trades += "\"magic\":" + JsonStr(I64(OrderMagicNumber())) + ",";
         trades += "\"comment\":" + JsonStr(OrderComment()) + ",";
         trades += "\"mfeMaeComplete\":false";
         trades += "}";
        }
      string s = "{";
      s += "\"eventId\":" + JsonStr(MakeEventId("HIST", tickets[start])) + ",";
      s += "\"type\":\"HISTORY_BATCH\",";
      s += "\"time\":" + I64((int)TimeCurrent()) + ",";
      s += "\"page\":" + I64(page + 1) + ",";
      s += "\"totalPages\":" + I64(totalPages) + ",";
      s += "\"trades\":[" + trades + "]";
      s += "}";
      QueueEvent(s);
     }
   if(count > 0) Log("history backfill queued: " + I64(count) + " orders");
  }

// ── MT4 entry points ───────────────────────────────────────────────────────

int OnInit()
  {
   if(StringLen(ApiToken) < 8 || StringFind(ApiToken, "paste") > 0)
     {
      LogErr("ApiToken is not set — create a connection in TradeJournal settings and paste the token.");
      return INIT_SUCCEEDED;
     }
   if(StringFind(ApiUrl, "https://") != 0)
      LogErr("ApiUrl must be HTTPS (WebRequest requirement).");

   LoadOutbox();
   bool firstRun = !FileIsExist(StateFileName(), FILE_COMMON);
   SendHeartbeat();
   if(firstRun || SendHistoryFromDate > 0)
      SendHistoryBackfill();
   Scan();
   EventKillTimer();
   EventSetTimer(MathMax(30, HeartbeatMinutes * 60));
   Log("initialized — server " + ServerName() + " login " + LoginName());
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   FlushOutbox();
  }

void OnTimer()
  {
   SendHeartbeat();
   Scan();
   FlushOutbox();
  }

void OnTick()
  {
   Scan();      // fast reaction to closes/partial closes
   FlushOutbox();
  }
//+------------------------------------------------------------------+
