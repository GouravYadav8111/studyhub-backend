const nodemailer = require("nodemailer");

const sendEmail = async (options) => {
  try {
    // 1. Create the transporter using your email service
    const transporter = nodemailer.createTransport({
      service: "gmail", 
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // 2. Define the email options with a professional HTML layout
    const mailOptions = {
      from: `"StudySpace Admin" <${process.env.EMAIL_USER}>`,
      to: options.email,
      subject: options.subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <div style="background-color: #1e293b; padding: 20px; text-align: center;">
            <h2 style="color: #ffffff; margin: 0;">StudySpace Partner</h2>
          </div>
          <div style="padding: 30px; background-color: #ffffff; color: #334155;">
            ${options.message}
          </div>
          <div style="background-color: #f8fafc; padding: 15px; text-align: center; font-size: 12px; color: #64748b;">
            © ${new Date().getFullYear()} StudySpace. All rights reserved.
          </div>
        </div>
      `,
    };

    // 3. Send the email
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("❌ Email sending failed:", error);
    return false;
  }
};

module.exports = sendEmail;