'use strict';

const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

// =============================================================================
// Notification Service
// =============================================================================
// Sends notifications via Ntfy and/or email based on admin preferences.
// Settings stored in profiles.notification_settings JSONB column.
// =============================================================================

// -----------------------------------------------------------------------------
// Send Ntfy notification
// -----------------------------------------------------------------------------
const sendNtfy = async (settings, { title, message, priority = 3, tags = [] }) => {
  if (!settings?.enabled || !settings?.url || !settings?.topic) return;

  try {
    const url = `${settings.url.replace(/\/$/, '')}/${settings.topic}`;
    const sanitize = (str) => str ? str.replace(/[^\x00-\x7F]/g, '') : str;

    const headers = {
      'Title': sanitize(title),
      'Priority': String(priority),
      'Content-Type': 'text/plain',
    };
    if (tags.length > 0) {
      headers['Tags'] = sanitize(tags.join(','));
    }
    if (settings.token) {
      headers['Authorization'] = `Bearer ${settings.token}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: message,
    });

    if (!response.ok) {
      logger.warn('Ntfy notification failed', { status: response.status, url });
    } else {
      logger.info('Ntfy notification sent', { topic: settings.topic, title });
    }
  } catch (err) {
    logger.error('Ntfy notification error', { error: err.message });
  }
};

// -----------------------------------------------------------------------------
// Send email notification
// -----------------------------------------------------------------------------
const sendEmail = async (settings, { subject, html, text }) => {
  if (!settings?.enabled || !settings?.recipient) return;

  try {
    // Use Supabase SMTP config from environment
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: `"${process.env.SMTP_SENDER_NAME || 'portfolioTraker'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
      to: settings.recipient,
      subject,
      html,
      text,
    });

    logger.info('Email notification sent', { to: settings.recipient, subject });
  } catch (err) {
    logger.error('Email notification error', { error: err.message });
  }
};

// -----------------------------------------------------------------------------
// Send notification to all admins who have it enabled
// -----------------------------------------------------------------------------
const notifyAdmins = async (supabase, { title, message, subject, html, priority = 3, tags = [] }) => {
  try {
    // Get all admin profiles with notification settings
    const { data: admins, error } = await supabase
      .from('profiles')
      .select('id, display_name, notification_settings')
      .eq('role', 'admin');

    if (error || !admins?.length) return;

    for (const admin of admins) {
      const settings = admin.notification_settings || {};

      // Send Ntfy
      if (settings.ntfy?.enabled) {
        await sendNtfy(settings.ntfy, { title, message, priority, tags });
      }

      // Send email
      if (settings.email?.enabled) {
        await sendEmail(settings.email, {
          subject: subject || title,
          html: html || `<p>${message}</p>`,
          text: message,
        });
      }
    }
  } catch (err) {
    logger.error('notifyAdmins error', { error: err.message });
  }
};

// -----------------------------------------------------------------------------
// Test notification (send to a specific admin's settings)
// -----------------------------------------------------------------------------
const testNotification = async (channel, settings) => {
  if (channel === 'ntfy') {
    await sendNtfy(settings, {
      title: 'portfolioTraker — Test Notification',
      message: 'Ntfy notifications are working correctly.',
      priority: 3,
      tags: ['white_check_mark'],
    });
  } else if (channel === 'email') {
    await sendEmail(settings, {
      subject: 'portfolioTraker — Test Notification',
      html: '<p>Email notifications are working correctly.</p>',
      text: 'Email notifications are working correctly.',
    });
  }
};

module.exports = { notifyAdmins, testNotification, sendNtfy, sendEmail };
