"use client";

type QuickReplyChipsProps = {
  chips: string[];
  disabled?: boolean;
  onSelect: (chip: string) => void;
};

export function QuickReplyChips({ chips, disabled, onSelect }: QuickReplyChipsProps) {
  if (!chips.length) return null;

  return (
    <div className="quick-replies" aria-label="Suggested replies">
      {chips.map((chip) => (
        <button key={chip} type="button" disabled={disabled} onClick={() => onSelect(chip)}>
          {chip}
        </button>
      ))}
    </div>
  );
}
