import Image from "next/image";

type TypingIndicatorProps = {
  isWaking?: boolean;
};

export function TypingIndicator({ isWaking: _isWaking }: TypingIndicatorProps) {
  return (
    <div className="message-row is-assistant">
      <div className="assistant-avatar" aria-hidden="true">
        <Image src="/bowie_ai_mascot_logo.png" alt="" width={34} height={34} />
      </div>
      <div className="message-bubble typing" aria-label="Bowie is typing">
        <strong>Bowie is thinking</strong>
        <span className="typing-orbit" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}
