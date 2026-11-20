package com.voltatech.landlordhub;

import android.app.Notification;
import android.os.Bundle;
import android.provider.Telephony;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import androidx.core.app.NotificationCompat;

import java.util.List;

/**
 * Reads only the pop-up notifications of the phone's own messages app — never the SMS inbox.
 * When a pop-up comes from MTN MoMo, Airtel Money or Zamtel and says money was received, it is
 * kept for Landlord Hub, which matches the sender's number to a tenant and takes it off their rent.
 * Every other notification is ignored and not stored.
 *
 * The landlord switches this on once in Settings → Notification access → Landlord Hub.
 */
public class PaymentNotificationListener extends NotificationListenerService {

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || sbn.getNotification() == null) return;
        // Only the phone's default SMS app. Any other app could post a pop-up titled "MoMo".
        String smsApp = Telephony.Sms.getDefaultSmsPackage(this);
        if (smsApp == null || !smsApp.equals(sbn.getPackageName())) return;

        Notification n = sbn.getNotification();
        // A summary of grouped messages ("3 new messages") carries no message text.
        if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;

        NotificationCompat.MessagingStyle style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n);
        if (style != null && !style.getMessages().isEmpty()) {
            // Modern messages apps: the notification holds the latest messages of one conversation.
            CharSequence conv = style.getConversationTitle();
            List<NotificationCompat.MessagingStyle.Message> msgs = style.getMessages();
            for (NotificationCompat.MessagingStyle.Message m : msgs) {
                CharSequence who = m.getPerson() != null ? m.getPerson().getName() : null;
                if (who == null || who.length() == 0) who = conv != null ? conv : title(n);
                take(str(who), str(m.getText()), m.getTimestamp() > 0 ? m.getTimestamp() : sbn.getPostTime());
            }
            return;
        }

        // Older messages apps: the sender is the title and the message is the text.
        Bundle x = n.extras;
        CharSequence body = x.getCharSequence(Notification.EXTRA_BIG_TEXT);
        if (body == null) body = x.getCharSequence(Notification.EXTRA_TEXT);
        take(title(n), str(body), sbn.getPostTime());
    }

    private void take(String from, String body, long date) {
        if (!SmsStore.isTrustedSender(from) || !SmsStore.looksLikeMoneyIn(body)) return;
        if (!SmsStore.add(this, from, body, date)) return; // already seen (the pop-up was updated)
        // If the app is open it records the payment straight away; otherwise as soon as it opens.
        SmsReaderPlugin.deliverLive(from, body, date);
    }

    private static String title(Notification n) {
        CharSequence t = n.extras.getCharSequence(Notification.EXTRA_TITLE);
        return str(t);
    }

    private static String str(CharSequence s) {
        return s == null ? "" : s.toString();
    }
}
