import { generateText } from "ai";

import { getActiveModel, getProviderConfig } from "@/lib/ai/provider";
import { requireBackendAccess } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AddressLookupRequest = {
  text?: string;
  language?: "sinhala" | "tamil";
};

type ParsedAddressInput = {
  searchQuery: string;
  addressText?: string | null;
  city?: string | null;
  recipientName?: string | null;
  phone?: string | null;
  addressType?: "home" | "office" | "other" | null;
  deliveryDate?: string | null;
  senderName?: string | null;
  giftMessage?: string | null;
};

type GooglePrediction = {
  description?: string;
  place_id?: string;
};

type GoogleAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type GooglePlaceDetails = {
  name?: string;
  formatted_address?: string;
  address_components?: GoogleAddressComponent[];
  geometry?: {
    location?: {
      lat?: number;
      lng?: number;
    };
  };
};

export async function POST(req: Request) {
  const accessDenied = await requireBackendAccess(req, {
    route: "address lookup",
    requireSecretInProduction: true
  });
  if (accessDenied) return accessDenied;

  const body = (await req.json()) as AddressLookupRequest;
  const text = body.text?.trim() ?? "";
  if (!text) {
    return Response.json({ error: "Address text is required." }, { status: 400 });
  }

  const apiKey = getGooglePlacesApiKey();
  if (!apiKey) {
    return Response.json(
      { error: "GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY is required for localized address lookup." },
      { status: 500 }
    );
  }

  const parsed = await parseAddressForGoogle(text, body.language ?? detectScriptLanguage(text));
  if (parsed.searchQuery.length < 3) {
    return Response.json({ error: "I could not read a searchable address from that message." }, { status: 422 });
  }

  const predictions = await fetchPlacePredictions(parsed.searchQuery, apiKey);
  const rawCandidates = (
    await Promise.all(
      predictions.slice(0, 3).map(async (prediction) => {
        if (!prediction.place_id) return fallbackCandidate(prediction, parsed.city);
        try {
          const details = await fetchPlaceDetails(prediction.place_id, apiKey);
          return placeDetailsToCandidate(prediction.place_id, prediction.description, details, parsed.city);
        } catch {
          return fallbackCandidate(prediction, parsed.city);
        }
      })
    )
  ).filter(isAddressCandidate);
  const candidates = await Promise.all(
    rawCandidates.map((candidate) => mergeCandidateAddressWithUserInput(candidate, parsed, text))
  );

  return Response.json({
    inputLanguage: body.language ?? detectScriptLanguage(text),
    parsed,
    candidates
  });
}

async function mergeCandidateAddressWithUserInput(
  candidate: NonNullable<ReturnType<typeof fallbackCandidate>>,
  parsed: ParsedAddressInput,
  originalText: string
) {
  const providerConfig = getProviderConfig();
  const googleAddress = candidate.mcpAddress || candidate.formattedAddress;

  try {
    const result = await generateText({
      model: getActiveModel(1, originalText, providerConfig),
      system: `You merge a user-provided Sri Lankan delivery address with a Google Places result.

Return only JSON:
{
  "mcpAddress": "clean English/romanized delivery address for Kapruka",
  "city": "English city/locality"
}

Rules:
- Preserve specific user-provided house numbers, lane names, road names,
  apartment names, landmarks, and locality details when they are present.
- Always include the selected Google road/locality from googleFormattedAddress
  unless the user's address provides a more specific English road/locality.
- Use Google to canonicalize locality/city spelling and remove ambiguity.
- Do not invent house numbers, apartment numbers, or recipient details.
- Output must contain only English/romanized Latin characters, digits,
  punctuation, and spaces.
- Do not include address type, phone number, recipient name, sender name, date,
  or gift message.`,
      prompt: JSON.stringify({
        originalUserText: originalText,
        parsedAddressText: parsed.addressText,
        parsedCity: parsed.city,
        googleFormattedAddress: googleAddress,
        googleCity: candidate.city
      }),
      temperature: 0
    });
    const merged = parseJsonObject(result.text) as { mcpAddress?: unknown; city?: unknown };
    const mcpAddress = ensureSelectedGoogleAddressSpecificity(
      cleanString(merged.mcpAddress),
      googleAddress,
      originalText
    );
    const city = cleanString(merged.city);

    return {
      ...candidate,
      mcpAddress,
      city: city || candidate.city || parsed.city
    };
  } catch {
    return {
      ...candidate,
      mcpAddress: composeUserGoogleAddress(originalText, googleAddress)
    };
  }
}

function ensureSelectedGoogleAddressSpecificity(
  mergedAddress: string | undefined,
  googleAddress: string,
  originalText: string
) {
  const composedAddress = composeUserGoogleAddress(originalText, googleAddress);
  if (!mergedAddress) return composedAddress;

  const googleSpecificPart = getSpecificGoogleAddressPart(googleAddress);
  if (!googleSpecificPart) return withUserAddressPrefix(mergedAddress, originalText);

  const mergedNormalized = normalizeAddressForComparison(mergedAddress);
  const googleTokens = normalizeAddressForComparison(googleSpecificPart)
    .split(" ")
    .filter((token) => token.length >= 4 && !["road", "lane", "street", "matale", "colombo", "kandy"].includes(token));

  const keepsSelectedPlace = googleTokens.some((token) => mergedNormalized.includes(token));
  if (!keepsSelectedPlace) return composedAddress;

  return withUserAddressPrefix(mergedAddress, originalText);
}

function composeUserGoogleAddress(originalText: string, googleAddress: string) {
  const prefix = extractUserAddressPrefix(originalText);
  const cleanedGoogleAddress = cleanFormattedAddress(googleAddress);
  if (!prefix) return cleanedGoogleAddress;
  if (normalizeAddressForComparison(cleanedGoogleAddress).startsWith(normalizeAddressForComparison(prefix))) {
    return cleanedGoogleAddress;
  }
  return `${prefix}, ${cleanedGoogleAddress}`;
}

function withUserAddressPrefix(address: string, originalText: string) {
  const prefix = extractUserAddressPrefix(originalText);
  if (!prefix) return address;
  if (normalizeAddressForComparison(address).includes(normalizeAddressForComparison(prefix))) return address;
  return `${prefix}, ${address}`;
}

function extractUserAddressPrefix(text: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^\s*((?:no\.?\s*)?[A-Za-z0-9][A-Za-z0-9/ -]{0,24})\s*[,،]/i);
  return match?.[1]?.replace(/\s+/g, " ").trim() || "";
}

function getSpecificGoogleAddressPart(address: string) {
  return cleanFormattedAddress(address)
    .split(",")
    .map((part) => part.trim())
    .find((part) => /[A-Za-z]/.test(part) && !/^(sri\s*lanka|western|central|southern|northern|eastern|north|south|matale|colombo|kandy)$/i.test(part));
}

function normalizeAddressForComparison(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

async function parseAddressForGoogle(text: string, language: "sinhala" | "tamil" | null): Promise<ParsedAddressInput> {
  const providerConfig = getProviderConfig();

  try {
    const result = await generateText({
      model: getActiveModel(1, text, providerConfig),
      system: `You parse Sri Lankan checkout messages for Google Places lookup.

Return only compact JSON with these fields:
{
  "searchQuery": "English Google Places autocomplete query, Sri Lanka",
  "addressText": "the original address portion only, if present",
  "city": "English city/locality if present",
  "recipientName": "recipient name if present, romanized in English letters",
  "phone": "phone number if present",
  "addressType": "home|office|other|null",
  "deliveryDate": "YYYY-MM-DD if present, otherwise null",
  "senderName": "sender name if present, romanized in English letters",
  "giftMessage": "gift message if present, translated or romanized into English letters"
}

Rules:
- The user may write Sinhala script, Tamil script, Singlish, Tanglish, or mixed language.
- Canonicalize the address/search query into English for Google Places Autocomplete.
- Romanize recipient names and sender names into English letters.
- Translate or romanize gift messages into English letters.
- Preserve phone numbers and dates exactly.
- Include likely locality/city and "Sri Lanka" in searchQuery.
- Do not invent house numbers or streets that are not implied by the text.`,
      prompt: text,
      temperature: 0
    });

    const parsed = parseJsonObject(result.text) as Partial<ParsedAddressInput>;
    const searchQuery = cleanString(parsed.searchQuery) || fallbackSearchQuery(text, language);

    return {
      searchQuery,
      addressText: cleanString(parsed.addressText),
      city: cleanString(parsed.city),
      recipientName: cleanString(parsed.recipientName),
      phone: cleanString(parsed.phone),
      addressType: normalizeAddressType(parsed.addressType),
      deliveryDate: cleanString(parsed.deliveryDate),
      senderName: cleanString(parsed.senderName),
      giftMessage: cleanString(parsed.giftMessage)
    };
  } catch {
    return {
      searchQuery: fallbackSearchQuery(text, language)
    };
  }
}

async function fetchPlacePredictions(input: string, apiKey: string): Promise<GooglePrediction[]> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
  url.searchParams.set("input", input);
  url.searchParams.set("components", "country:lk");
  url.searchParams.set("language", "en");
  url.searchParams.set("key", apiKey);

  const response = await fetch(url);
  const payload = (await response.json()) as {
    status?: string;
    error_message?: string;
    predictions?: GooglePrediction[];
  };

  if (!response.ok || (payload.status && !["OK", "ZERO_RESULTS"].includes(payload.status))) {
    throw new Error(payload.error_message || `Google Places autocomplete failed with ${payload.status || response.status}`);
  }

  return Array.isArray(payload.predictions) ? payload.predictions : [];
}

async function fetchPlaceDetails(placeId: string, apiKey: string): Promise<GooglePlaceDetails> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", "name,formatted_address,address_component,geometry/location");
  url.searchParams.set("language", "en");
  url.searchParams.set("key", apiKey);

  const response = await fetch(url);
  const payload = (await response.json()) as {
    status?: string;
    error_message?: string;
    result?: GooglePlaceDetails;
  };

  if (!response.ok || payload.status !== "OK" || !payload.result) {
    throw new Error(payload.error_message || `Google Places details failed with ${payload.status || response.status}`);
  }

  return payload.result;
}

function placeDetailsToCandidate(
  placeId: string,
  predictionDescription: string | undefined,
  details: GooglePlaceDetails,
  fallbackCity?: string | null
) {
  const formattedAddress = cleanFormattedAddress(details.formatted_address || predictionDescription || "");
  if (!formattedAddress) return null;

  const city = extractCity(details.address_components) || cleanString(fallbackCity);

  return {
    placeId,
    name: cleanString(details.name),
    formattedAddress,
    city,
    mcpAddress: formattedAddress,
    location: readLocation(details)
  };
}

function fallbackCandidate(prediction: GooglePrediction, fallbackCity?: string | null) {
  if (!prediction.place_id || !prediction.description) return null;

  return {
    placeId: prediction.place_id,
    formattedAddress: cleanFormattedAddress(prediction.description),
    city: cleanString(fallbackCity),
    mcpAddress: cleanFormattedAddress(prediction.description)
  };
}

function readLocation(details: GooglePlaceDetails) {
  const lat = Number(details.geometry?.location?.lat);
  const lng = Number(details.geometry?.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return { lat, lng };
}

function isAddressCandidate(candidate: ReturnType<typeof fallbackCandidate>): candidate is NonNullable<ReturnType<typeof fallbackCandidate>> {
  return Boolean(candidate);
}

function extractCity(components?: GoogleAddressComponent[]) {
  if (!components?.length) return undefined;

  const cityTypes = [
    "locality",
    "postal_town",
    "administrative_area_level_3",
    "administrative_area_level_2",
    "sublocality_level_1"
  ];

  for (const type of cityTypes) {
    const component = components.find((entry) => entry.types?.includes(type));
    const name = cleanString(component?.long_name);
    if (name) return name;
  }

  return undefined;
}

function cleanFormattedAddress(value: string) {
  return cleanString(value)?.replace(/\s*,?\s*Sri Lanka\s*$/i, "").trim() || "";
}

function fallbackSearchQuery(text: string, language: "sinhala" | "tamil" | null) {
  return `${text.replace(/\s+/g, " ").trim()} Sri Lanka${language ? "" : ""}`;
}

function parseJsonObject(text: string) {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : cleaned);
}

function normalizeAddressType(value: unknown): ParsedAddressInput["addressType"] {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().trim();
  if (normalized === "home" || normalized === "house") return "home";
  if (normalized === "office") return "office";
  if (normalized === "other" || normalized === "apartment") return "other";
  return null;
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : undefined;
}

function detectScriptLanguage(text: string): "sinhala" | "tamil" | null {
  const sinhalaCount = Array.from(text.matchAll(/[\u0D80-\u0DFF]/g)).length;
  const tamilCount = Array.from(text.matchAll(/[\u0B80-\u0BFF]/g)).length;

  if (!sinhalaCount && !tamilCount) return null;
  return sinhalaCount >= tamilCount ? "sinhala" : "tamil";
}

function getGooglePlacesApiKey() {
  return process.env.GOOGLE_PLACES_API_KEY?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim();
}
