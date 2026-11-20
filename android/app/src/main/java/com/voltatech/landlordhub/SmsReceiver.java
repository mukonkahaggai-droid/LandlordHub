package com.voltatech.landlordhub;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Runs whenever an SMS arrives, even with the app closed. A long message comes in several parts,
 * so parts from the same sender are joined first. "Money received" messages are kept for the app
 * and the landlord gets a notification; every other message is ignored and not stored.
 */
public class SmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null) return;

        Map<String, StringBuilder> bodies = new LinkedHashMap<>();
        long date = System.currentTimeMillis();
        for (SmsMessage p : parts) {
            if (p == null) continue;
            String from = p.getDisplayOriginatingAddress();
            if (from == null) from = "";
            StringBuilder sb = bodies.get(from);
            if (sb == null) { sb = new StringBuilder(); bodies.put(from, sb); }
            sb.append(p.getDisplayMessageBody());
            date = p.getTimestampMillis();
        }

        for (Map.Entry<String, StringBuilder> e : bodies.entrySet()) {
            String body = e.getValue().toString();
            // Only MTN MoMo / Airtel Money themselves. Anyone can type "You have received K3,000" from their own phone.
            if (!SmsStore.isTrustedSender(e.getKey()) || !SmsStore.looksLikeMoneyIn(body)) continue;
            SmsStore.add(ctx, e.getKey(), body, date);
            // If the app is open, it records the payment straight away; otherwise it does so when opened.
            if (!SmsReaderPlugin.deliverLive(e.getKey(), body, date)) SmsStore.notifyPayment(ctx, body);
        }
    }
}
