package com.voltatech.landlordhub;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Holds "money received" SMS until the app opens and records them, and shows a notification
 * when one arrives. Only messages that look like money coming in are kept; nothing else from
 * the phone's inbox is stored or sent anywhere.
 */
final class SmsStore {
    private static final String PREFS = "landlordhub_sms";
    private static final String KEY = "pending";
    private static final String CHANNEL = "payments";
    private static final int MAX_KEPT = 200;

    // Money coming in, with an amount like "ZMW 2,000.00" or "K3000".
    private static final Pattern RECEIVED = Pattern.compile("(?i)(receiv|credited|deposit)");
    private static final Pattern AMOUNT = Pattern.compile("(?i)(ZMW|ZK|K)\\s?([0-9][0-9,]*(\\.[0-9]{1,2})?)");
    private static final Pattern SENT = Pattern.compile("(?i)\\b(you have sent|sent to|you paid|payment to|withdraw|airtime|bundle)\\b");

    private SmsStore() {}

    static boolean looksLikeMoneyIn(String body) {
        if (body == null) return false;
        return RECEIVED.matcher(body).find() && AMOUNT.matcher(body).find() && !SENT.matcher(body).find();
    }

    static synchronized void add(Context ctx, String from, String body, long date) {
        try {
            JSONArray list = read(ctx);
            // Same message twice (Android can deliver it again): keep one.
            for (int i = 0; i < list.length(); i++) {
                JSONObject o = list.getJSONObject(i);
                if (body.equals(o.optString("body")) && from.equals(o.optString("from"))) return;
            }
            JSONObject m = new JSONObject();
            m.put("from", from);
            m.put("body", body);
            m.put("date", date);
            list.put(m);
            while (list.length() > MAX_KEPT) list.remove(0);
            prefs(ctx).edit().putString(KEY, list.toString()).apply();
        } catch (JSONException ignored) {
        }
    }

    /** Returns everything waiting and clears it. */
    static synchronized JSONArray takeAll(Context ctx) {
        JSONArray list = read(ctx);
        prefs(ctx).edit().remove(KEY).apply();
        return list;
    }

    private static JSONArray read(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString(KEY, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** "K2,000 received — open Landlord Hub to record it." */
    static void notifyPayment(Context ctx, String body) {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Rent payments", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("When MTN MoMo or Airtel Money tells you money came in");
            ctx.getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        String amount = "Money";
        Matcher m = AMOUNT.matcher(body);
        if (m.find()) amount = "K" + m.group(2);
        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle(amount + " received")
                .setContentText("Open Landlord Hub to record it against the tenant's rent.")
                .setAutoCancel(true)
                .setContentIntent(pi);
        NotificationManagerCompat.from(ctx).notify((int) (System.currentTimeMillis() % 100000), b.build());
    }
}
