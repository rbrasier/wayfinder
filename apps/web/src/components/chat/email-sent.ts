// An Email step's record (RunEmailNode): who it went to, the subject, and the
// message as sent. A record written before the message was kept has none.
export interface EmailSent {
  recipients: string[];
  subject: string;
  message: string | null;
}

export const emailSentFromFields = (fields: ReadonlyArray<{ key: string; value: string }>): EmailSent => {
  const valueOf = (key: string): string | undefined => fields.find((field) => field.key === key)?.value;
  return {
    recipients: (valueOf("recipients") ?? "")
      .split(",")
      .map((address) => address.trim())
      .filter(Boolean),
    subject: valueOf("subject") ?? "",
    message: valueOf("message") ?? null,
  };
};
