"use client";

type Props = {
  message: string;
  onDismiss?: () => void;
};

/** Short error the operator can see without hunting the form. */
export function Toast({ message, onDismiss }: Props) {
  return (
    <div className="toast" role="alert">
      <p>{message}</p>
      {onDismiss ? (
        <button type="button" className="toast-dismiss" onClick={onDismiss}>
          Chiudi
        </button>
      ) : null}
    </div>
  );
}
