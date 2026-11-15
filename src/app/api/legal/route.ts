/**
 * GET /api/legal — public legal identity (mentions légales, RGPD contact).
 * Values come from LEGAL_* env vars with neutral fallbacks so the pages
 * always render; no authentication, no personal data.
 */
import { NextResponse } from "next/server";

export interface LegalIdentity {
  entityName: string;
  contactEmail: string;
  address: string;
  privacyContact: string;
  supervisoryAuthority: string;
}

export async function GET() {
  const identity: LegalIdentity = {
    entityName: process.env.LEGAL_ENTITY_NAME || "L'éditeur de Promethe",
    contactEmail: process.env.LEGAL_CONTACT_EMAIL || "contact@tradejournal.app",
    address: process.env.LEGAL_ADDRESS || "Adresse sur demande",
    privacyContact: process.env.PRIVACY_CONTACT_EMAIL || "privacy@tradejournal.app",
    supervisoryAuthority: process.env.SUPERVISORY_AUTHORITY || "CNIL",
  };
  return NextResponse.json(identity, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
