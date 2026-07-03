"use client";

import { Check, MapPin, Pencil } from "lucide-react";
import type { AddressCandidate, AddressLookupResult } from "@/lib/types";

type AddressConfirmationCardProps = {
  lookup: AddressLookupResult;
  onConfirm: (candidate: AddressCandidate) => void;
  onEdit: () => void;
};

export function AddressConfirmationCard({ lookup, onConfirm, onEdit }: AddressConfirmationCardProps) {
  const copy = getAddressCopy(lookup.inputLanguage);

  return (
    <section className="info-card address-confirmation-card" aria-label="Confirm delivery address">
      <header>
        <span>Google Places</span>
        <h3>{copy.heading}</h3>
      </header>

      <div className="address-candidate-list">
        {lookup.candidates.map((candidate, index) => (
          <article key={candidate.placeId} className="address-candidate">
            <MapPin size={18} strokeWidth={2} aria-hidden="true" />
            <div>
              <strong>{candidate.name || `Address ${index + 1}`}</strong>
              <p>{candidate.formattedAddress}</p>
              {candidate.city ? <small>{copy.city}: {candidate.city}</small> : null}
              {candidate.location ? (
                <iframe
                  className="address-map-preview"
                  title={`Map preview for ${candidate.name || candidate.formattedAddress}`}
                  src={getMapEmbedUrl(candidate, lookup.inputLanguage)}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              ) : null}
            </div>
            <button type="button" onClick={() => onConfirm(candidate)}>
              <Check size={16} strokeWidth={2.4} aria-hidden="true" />
              {copy.use}
            </button>
          </article>
        ))}
      </div>

      <button className="address-edit-button" type="button" onClick={onEdit}>
        <Pencil size={16} strokeWidth={2} aria-hidden="true" />
        {copy.edit}
      </button>
    </section>
  );
}

function getMapEmbedUrl(candidate: AddressCandidate, language: AddressLookupResult["inputLanguage"]) {
  const query = candidate.location
    ? `${candidate.location.lat},${candidate.location.lng}`
    : candidate.formattedAddress;
  const hl = language === "tamil" ? "ta" : language === "sinhala" ? "si" : "en";
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=16&hl=${hl}&region=LK&output=embed`;
}

function getAddressCopy(language: AddressLookupResult["inputLanguage"]) {
  if (language === "tamil") {
    return {
      heading: "விநியோக முகவரியை உறுதிப்படுத்துங்கள்",
      city: "நகரம்",
      use: "பயன்படுத்து",
      edit: "முகவரியை திருத்து"
    };
  }

  if (language === "sinhala") {
    return {
      heading: "ඩිලිවරි ලිපිනය තහවුරු කරන්න",
      city: "නගරය",
      use: "භාවිත කරන්න",
      edit: "ලිපිනය වෙනස් කරන්න"
    };
  }

  return {
    heading: "Confirm the delivery address",
    city: "City",
    use: "Use",
    edit: "Edit address"
  };
}
