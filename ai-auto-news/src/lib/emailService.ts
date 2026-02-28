import nodemailer, { Transporter } from 'nodemailer';

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  html: string;
  text?: string;
  variables: string[];
}

interface EmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
}

interface BulkEmailJob {
  id: string;
  templateId: string;
  recipients: Array<{
    email: string;
    variables: Record<string, string>;
  }>;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  sentCount: number;
  failedCount: number;
  createdAt: Date;
  completedAt?: Date;
}

export class EmailService {
  private transporter: Transporter;
  private templates: Map<string, EmailTemplate> = new Map();
  private bulkJobs: Map<string, BulkEmailJob> = new Map();
  private fromEmail: string;
  private fromName: string;

  constructor() {
    const config: EmailConfig = {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASSWORD || '',
      },
    };

    this.fromEmail = process.env.FROM_EMAIL || 'noreply@yourdomain.com';
    this.fromName = process.env.FROM_NAME || 'AI Auto News';

    this.transporter = nodemailer.createTransport(config);
    this.initializeTemplates();
  }

  /**
   * Initialize email templates
   */
  private initializeTemplates(): void {
    // Welcome email
    this.registerTemplate({
      id: 'welcome',
      name: 'Welcome Email',
      subject: 'Welcome to {{appName}}!',
      html: `
        <h1>Welcome {{userName}}!</h1>
        <p>Thank you for joining {{appName}}. We're excited to have you on board.</p>
        <p>Here's what you can do next:</p>
        <ul>
          <li>Complete your profile</li>
          <li>Generate your first AI content</li>
          <li>Explore our features</li>
        </ul>
        <a href="{{dashboardUrl}}" style="background:#007bff;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;">Go to Dashboard</a>
      `,
      variables: ['userName', 'appName', 'dashboardUrl'],
    });

    // Password reset
    this.registerTemplate({
      id: 'password-reset',
      name: 'Password Reset',
      subject: 'Reset Your Password',
      html: `
        <h1>Password Reset Request</h1>
        <p>Hi {{userName}},</p>
        <p>We received a request to reset your password. Click the button below to reset it:</p>
        <a href="{{resetUrl}}" style="background:#007bff;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;">Reset Password</a>
        <p>This link will expire in {{expiryHours}} hours.</p>
        <p>If you didn't request this, please ignore this email.</p>
      `,
      variables: ['userName', 'resetUrl', 'expiryHours'],
    });

    // Email verification
    this.registerTemplate({
      id: 'email-verification',
      name: 'Email Verification',
      subject: 'Verify Your Email Address',
      html: `
        <h1>Verify Your Email</h1>
        <p>Hi {{userName}},</p>
        <p>Please verify your email address by clicking the button below:</p>
        <a href="{{verificationUrl}}" style="background:#28a745;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;">Verify Email</a>
        <p>This link will expire in {{expiryHours}} hours.</p>
      `,
      variables: ['userName', 'verificationUrl', 'expiryHours'],
    });

    // Subscription upgrade
    this.registerTemplate({
      id: 'subscription-upgrade',
      name: 'Subscription Upgrade Confirmation',
      subject: 'Your Subscription Has Been Upgraded',
      html: `
        <h1>Subscription Upgraded!</h1>
        <p>Hi {{userName}},</p>
        <p>Your subscription has been successfully upgraded to <strong>{{newTier}}</strong>.</p>
        <p><strong>New Benefits:</strong></p>
        <ul>
          {{#benefits}}
          <li>{{.}}</li>
          {{/benefits}}
        </ul>
        <p>Your next billing date is {{nextBillingDate}}.</p>
        <a href="{{billingUrl}}" style="background:#007bff;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;">View Billing</a>
      `,
      variables: ['userName', 'newTier', 'benefits', 'nextBillingDate', 'billingUrl'],
    });

    // Usage limit warning
    this.registerTemplate({
      id: 'usage-limit-warning',
      name: 'Usage Limit Warning',
      subject: 'You\'re Approaching Your Usage Limit',
      html: `
        <h1>Usage Limit Warning</h1>
        <p>Hi {{userName}},</p>
        <p>You've used <strong>{{usagePercentage}}%</strong> of your monthly API calls.</p>
        <p>Current usage: {{currentUsage}} / {{limit}} calls</p>
        <p>Consider upgrading to avoid interruption:</p>
        <a href="{{upgradeUrl}}" style="background:#ffc107;color:black;padding:10px 20px;text-decoration:none;border-radius:5px;">Upgrade Now</a>
      `,
      variables: ['userName', 'usagePercentage', 'currentUsage', 'limit', 'upgradeUrl'],
    });

    // Invoice
    this.registerTemplate({
      id: 'invoice',
      name: 'Invoice',
      subject: 'Invoice {{invoiceNumber}} from {{appName}}',
      html: `
        <h1>Invoice</h1>
        <p>Hi {{userName}},</p>
        <p>Thank you for your payment. Here are the details:</p>
        <table style="border-collapse:collapse;width:100%;max-width:500px;">
          <tr>
            <td style="padding:10px;border:1px solid #ddd;"><strong>Invoice Number:</strong></td>
            <td style="padding:10px;border:1px solid #ddd;">{{invoiceNumber}}</td>
          </tr>
          <tr>
            <td style="padding:10px;border:1px solid #ddd;"><strong>Date:</strong></td>
            <td style="padding:10px;border:1px solid #ddd;">{{invoiceDate}}</td>
          </tr>
          <tr>
            <td style="padding:10px;border:1px solid #ddd;"><strong>Amount:</strong></td>
            <td style="padding:10px;border:1px solid #ddd;">{{amount}}</td>
          </tr>
          <tr>
            <td style="padding:10px;border:1px solid #ddd;"><strong>Status:</strong></td>
            <td style="padding:10px;border:1px solid #ddd;">{{status}}</td>
          </tr>
        </table>
        <a href="{{invoiceUrl}}" style="background:#007bff;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;margin-top:20px;display:inline-block;">View Invoice</a>
      `,
      variables: ['userName', 'invoiceNumber', 'invoiceDate', 'amount', 'status', 'invoiceUrl', 'appName'],
    });

    // Weekly digest
    this.registerTemplate({
      id: 'weekly-digest',
      name: 'Weekly Digest',
      subject: 'Your Weekly Summary',
      html: `
        <h1>Your Weekly Summary</h1>
        <p>Hi {{userName}},</p>
        <p>Here's what happened this week:</p>
        <ul>
          <li><strong>{{postsGenerated}}</strong> posts generated</li>
          <li><strong>{{apiCalls}}</strong> API calls made</li>
          <li><strong>{{views}}</strong> total views</li>
        </ul>
        <h2>Top Performing Content:</h2>
        {{#topPosts}}
        <div style="margin:10px 0;padding:10px;border-left:3px solid #007bff;">
          <h3>{{title}}</h3>
          <p>{{views}} views</p>
        </div>
        {{/topPosts}}
        <a href="{{dashboardUrl}}" style="background:#007bff;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;">View Dashboard</a>
      `,
      variables: ['userName', 'postsGenerated', 'apiCalls', 'views', 'topPosts', 'dashboardUrl'],
    });
  }

  /**
   * Register an email template
   */
  registerTemplate(template: EmailTemplate): void {
    this.templates.set(template.id, template);
  }

  /**
   * Render template with variables
   */
  private renderTemplate(templateId: string, variables: Record<string, any>): { subject: string; html: string; text?: string } {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    let subject = template.subject;
    let html = template.html;
    let text = template.text;

    // Replace variables
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      subject = subject.replace(regex, String(value));
      html = html.replace(regex, String(value));
      if (text) {
        text = text.replace(regex, String(value));
      }
    }

    return { subject, html, text };
  }

  /**
   * Send email
   */
  async sendEmail(options: EmailOptions): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        cc: options.cc ? (Array.isArray(options.cc) ? options.cc.join(', ') : options.cc) : undefined,
        bcc: options.bcc ? (Array.isArray(options.bcc) ? options.bcc.join(', ') : options.bcc) : undefined,
        replyTo: options.replyTo,
        subject: options.subject,
        html: options.html,
        text: options.text,
        attachments: options.attachments,
      });

      console.log(`Email sent successfully to ${options.to}`);
    } catch (error) {
      console.error('Failed to send email:', error);
      throw error;
    }
  }

  /**
   * Send templated email
   */
  async sendTemplatedEmail(
    to: string | string[],
    templateId: string,
    variables: Record<string, any>
  ): Promise<void> {
    const rendered = this.renderTemplate(templateId, variables);
    await this.sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  /**
   * Send bulk emails
   */
  async sendBulkEmails(
    templateId: string,
    recipients: Array<{ email: string; variables: Record<string, string> }>
  ): Promise<BulkEmailJob> {
    const jobId = `bulk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const job: BulkEmailJob = {
      id: jobId,
      templateId,
      recipients,
      status: 'pending',
      sentCount: 0,
      failedCount: 0,
      createdAt: new Date(),
    };

    this.bulkJobs.set(jobId, job);

    // Process in background
    this.processBulkJob(job);

    return job;
  }

  /**
   * Process bulk email job
   */
  private async processBulkJob(job: BulkEmailJob): Promise<void> {
    job.status = 'processing';

    for (const recipient of job.recipients) {
      try {
        await this.sendTemplatedEmail(recipient.email, job.templateId, recipient.variables);
        job.sentCount++;
      } catch (error) {
        console.error(`Failed to send email to ${recipient.email}:`, error);
        job.failedCount++;
      }

      // Rate limiting: wait between emails
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    job.status = 'completed';
    job.completedAt = new Date();
  }

  /**
   * Get bulk job status
   */
  getBulkJobStatus(jobId: string): BulkEmailJob | null {
    return this.bulkJobs.get(jobId) || null;
  }

  /**
   * Verify email configuration
   */
  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      console.log('Email service is ready');
      return true;
    } catch (error) {
      console.error('Email service verification failed:', error);
      return false;
    }
  }

  /**
   * Send test email
   */
  async sendTestEmail(to: string): Promise<void> {
    await this.sendEmail({
      to,
      subject: 'Test Email from AI Auto News',
      html: '<h1>Test Email</h1><p>This is a test email. If you received this, the email service is working correctly.</p>',
      text: 'Test Email - This is a test email. If you received this, the email service is working correctly.',
    });
  }
}

// Singleton instance
let emailServiceInstance: EmailService | null = null;

export function getEmailService(): EmailService {
  if (!emailServiceInstance) {
    emailServiceInstance = new EmailService();
  }
  return emailServiceInstance;
}

export type { EmailTemplate, EmailOptions, BulkEmailJob };
