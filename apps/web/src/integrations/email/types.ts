export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
