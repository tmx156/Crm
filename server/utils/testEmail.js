const { sendEmail } = require('./emailService');

(async () => {
  const to = process.env.EMAIL_USER || 'focusmoldels.co.uk@gmail.com';
  const subject = 'Test Email from CRM Nodemailer Integration';
  const text = 'This is a test email sent from your CRM backend using Nodemailer and Gmail.';

  const result = await sendEmail(to, subject, text);
  console.log(result);
})();
