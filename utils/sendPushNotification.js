const webpush = require('web-push');
const Subscription = require('../models/Subscription');

/**
 * Send a native system-tray push notification to a specific user
 * @param {string} userId - Target User ID
 * @param {object} payload - { title, message, icon, url }
 */
const sendPushNotification = async (userId, { title, message, icon = '/logo192.png', url = '/' }) => {
  try {
    const subscriptions = await Subscription.find({ user_id: userId });
    if (!subscriptions || subscriptions.length === 0) return;

    const notificationPayload = JSON.stringify({
      title,
      body: message,
      icon,
      url
    });

    const sendPromises = subscriptions.map((sub) =>
      webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: sub.keys
        },
        notificationPayload
      ).catch(async (err) => {
        // Automatically purge expired or invalid device tokens (HTTP 410 / 404)
        if (err.statusCode === 410 || err.statusCode === 404) {
          await Subscription.deleteOne({ endpoint: sub.endpoint });
        }
      })
    );

    await Promise.allSettled(sendPromises);
  } catch (err) {
    console.error('Error delivering push notification:', err);
  }
};

module.exports = sendPushNotification;