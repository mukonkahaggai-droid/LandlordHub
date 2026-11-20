package com.voltatech.landlordhub;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.regex.Pattern;

/**
 * Holds "money received" messages (read from MoMo / Airtel / Zamtel pop-ups) until the app opens
 * and records them. Only messages that look like money coming in are kept; nothing else is stored
 * or sent anywhere, and nothing is shown to the landlord.
 */
final class SmsStore {
    private static final String PREFS = "landlordhub_sms";
    private static final String KEY = "pending";
    private static final String SEEN = "seen";
    private static final int MAX_KEPT = 200;

    // Money coming in, with an amount like "ZMW 2,000.00" or "K3000".
    private static final Pattern RECEIVED = Pattern.compile("(?i)(receiv|credited|deposit)");
    private static final Pattern AMOUNT = Pattern.compile("(?i)(ZMW|ZK|K)\\s?([0-9][0-9,]*(\\.[0-9]{1,2})?)");
    private static final Pattern SENT = Pattern.compile("(?i)\\b(you have sent|sent to|you paid|payment to|withdraw|airtime|bundle)\\b");

    // Who real "money received" SMS come from. They use a name (e.g. "MoMo", "AirtelMoney", "Zamtel"),
    // never a phone number, so a text typed on someone's phone is never trusted.
    // If real payment SMS stop being picked up, check the sender name in Messages and add it here
    // (and to TRUSTED_SENDER in app.js).
    private static final Pattern TRUSTED_SENDER = Pattern.compile("(?i)(momo|mtn|airtel|zamtel|kwacha)");

    private SmsStore() {}

    static boolean isTrustedSender(String from) {
        if (from == null) return false;
        String f = from.trim();
        // A phone number (digits, +, spaces) can be anyone.
        if (!f.matches(".*[A-Za-z].*")) return false;
        return TRUSTED_SENDER.matcher(f).find();
    }

    static boolean looksLikeMoneyIn(String body) {
        if (body == null) return false;
        return RECEIVED.matcher(body).find() && AMOUNT.matcher(body).find() && !SENT.matcher(body).find();
    }

    /** Keeps a message for the app. Returns false if it was already seen (pop-ups are often updated). */
    static synchronized boolean add(Context ctx, String from, String body, long date) {
        try {
            String key = from + "|" + body;
            JSONArray seen = read(ctx, SEEN);
            for (int i = 0; i < seen.length(); i++) if (key.equals(seen.optString(i))) return false;
            seen.put(key);
            while (seen.length() > MAX_KEPT) seen.remove(0);

            JSONArray list = read(ctx, KEY);
            JSONObject m = new JSONObject();
            m.put("from", from);
            m.put("body", body);
            m.put("date", date);
            list.put(m);
            while (list.length() > MAX_KEPT) list.remove(0);
            prefs(ctx).edit().putString(KEY, list.toString()).putString(SEEN, seen.toString()).apply();
            return true;
        } catch (JSONException ignored) {
            return false;
        }
    }

    /** Returns everything waiting and clears it. */
    static synchronized JSONArray takeAll(Context ctx) {
        JSONArray list = read(ctx, KEY);
        prefs(ctx).edit().remove(KEY).apply();
        return list;
    }

    private static JSONArray read(Context ctx, String key) {
        try {
            return new JSONArray(prefs(ctx).getString(key, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
