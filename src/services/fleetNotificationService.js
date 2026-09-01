const cron = require('node-cron');
const FleetVehicle = require('../database/models/FleetVehicle');
const { sendEmail } = require('./emailService');
const logger = require('../utils/logger');

const NOTIFICATION_THRESHOLDS = [30, 14, 7];

const CHECK_TYPES = [
  { column: 'stk_valid_until', label: 'STK', labelFull: 'Technická kontrola (STK)' },
  { column: 'ek_valid_until', label: 'EK', labelFull: 'Emisná kontrola (EK)' },
  { column: 'highway_sticker_valid_until', label: 'Diaľničná známka', labelFull: 'Diaľničná známka' }
];

class FleetNotificationService {
  constructor() {
    this.cronJob = null;
  }

  start() {
    this.cronJob = cron.schedule('0 8 * * *', async () => {
      logger.info('Fleet notification check started');
      await this.checkExpirations();
    });
    logger.info('Fleet notification service started', { schedule: 'daily at 8:00 AM' });
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
  }

  async checkExpirations() {
    try {
      const vehicles = await FleetVehicle.findAll(true);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const vehicle of vehicles) {
        for (const check of CHECK_TYPES) {
          const expiryDate = vehicle[check.column];
          if (!expiryDate) continue;

          const expiry = new Date(expiryDate);
          expiry.setHours(0, 0, 0, 0);
          const daysRemaining = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

          if (daysRemaining < 0) continue;

          for (const threshold of NOTIFICATION_THRESHOLDS) {
            if (daysRemaining <= threshold) {
              await this.sendIfNotAlreadySent(vehicle, check, threshold, daysRemaining, expiry);
              break;
            }
          }
        }
      }

      logger.info('Fleet notification check completed');
    } catch (error) {
      logger.error('Fleet notification check failed', { error: error.message });
    }
  }

  async sendIfNotAlreadySent(vehicle, check, threshold, daysRemaining, expiryDate) {
    const notifType = `${check.column}_${threshold}d`;

    try {
      const alreadySent = await FleetVehicle.wasNotificationSent(vehicle.id, notifType, threshold);
      if (alreadySent) return;

      const sent = await sendEmail({
        to: vehicle.notification_email,
        subject: `⚠️ ${check.label} - ${vehicle.name} (${vehicle.license_plate}) - platnosť končí o ${daysRemaining} dní`,
        html: this.buildEmailHtml(vehicle, check, daysRemaining, expiryDate)
      });

      if (sent) {
        await FleetVehicle.logNotification(vehicle.id, notifType, threshold, vehicle.notification_email);
        logger.info('Fleet notification sent', {
          vehicle: vehicle.name,
          type: check.label,
          daysRemaining,
          email: vehicle.notification_email
        });
      }
    } catch (error) {
      logger.error('Failed to process fleet notification', {
        vehicleId: vehicle.id,
        type: check.label,
        error: error.message
      });
    }
  }

  buildEmailHtml(vehicle, check, daysRemaining, expiryDate) {
    const formattedDate = expiryDate.toLocaleDateString('sk-SK', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

    const urgencyColor = daysRemaining <= 7 ? '#dc2626' : daysRemaining <= 14 ? '#f59e0b' : '#3b82f6';
    const urgencyLabel = daysRemaining <= 7 ? 'URGENTNÉ' : daysRemaining <= 14 ? 'DÔLEŽITÉ' : 'UPOZORNENIE';

    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f3f4f6;">
        <div style="max-width: 560px; margin: 0 auto; padding: 24px;">
          <div style="background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

            <div style="background: ${urgencyColor}; color: #fff; padding: 20px 24px; text-align: center;">
              <div style="font-size: 12px; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px;">${urgencyLabel}</div>
              <div style="font-size: 20px; font-weight: 700;">${check.labelFull}</div>
              <div style="font-size: 14px; margin-top: 4px; opacity: 0.9;">Platnosť končí o ${daysRemaining} dní</div>
            </div>

            <div style="padding: 24px;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 13px;">Vozidlo</td>
                  <td style="padding: 8px 0; font-weight: 600; font-size: 14px;">${vehicle.name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 13px;">ŠPZ</td>
                  <td style="padding: 8px 0; font-weight: 600; font-size: 14px;">${vehicle.license_plate}</td>
                </tr>
                ${vehicle.brand ? `<tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 13px;">Značka / Model</td>
                  <td style="padding: 8px 0; font-size: 14px;">${vehicle.brand}${vehicle.model ? ' ' + vehicle.model : ''}</td>
                </tr>` : ''}
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 13px;">Dátum expirácie</td>
                  <td style="padding: 8px 0; font-weight: 700; font-size: 14px; color: ${urgencyColor};">${formattedDate}</td>
                </tr>
              </table>
            </div>

            <div style="padding: 0 24px 24px; text-align: center;">
              <div style="padding: 12px; background: #f9fafb; border-radius: 8px; font-size: 13px; color: #6b7280;">
                Prosím zabezpečte obnovenie ${check.label} pred dátumom expirácie.
                Po obnovení aktualizujte údaje v systéme ETILOG Portal.
              </div>
            </div>

            <div style="border-top: 1px solid #e5e7eb; padding: 16px 24px; text-align: center; font-size: 12px; color: #9ca3af;">
              ETILOG Approval System &bull; Automatická notifikácia vozového parku
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

module.exports = FleetNotificationService;
