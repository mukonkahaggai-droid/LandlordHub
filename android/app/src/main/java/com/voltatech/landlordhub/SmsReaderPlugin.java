package com.voltatech.landlordhub;

import android.content.ComponentName;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The app's window onto MoMo, Airtel and Zamtel "money received" pop-ups (used from native.js).
 * No SMS permission is used: the landlord turns on Notification access for Landlord Hub once, and
 * PaymentNotificationListener passes on only money-received pop-ups from the messages app.
 */
@CapacitorPlugin(name = "SmsReader")
public class SmsReaderPlugin extends Plugin {
    private static SmsReaderPlugin live;

    @Override
    public void load() { live = this; }

    @Override
    protected void handleOnDestroy() { if (live == this) live = null; }

    /** Called by PaymentNotificationListener. Returns true if the open app took the message. */
    static boolean deliverLive(String from, String body, long date) {
        SmsReaderPlugin p = live;
        if (p == null || p.getBridge() == null || p.getActivity() == null || !p.hasListeners("smsReceived")) return false;
        JSObject m = new JSObject();
        m.put("from", from);
        m.put("body", body);
        m.put("date", date);
        p.notifyListeners("smsReceived", m);
        // It stays in the store too; the app clears it after recording, so nothing is lost.
        return true;
    }

    private boolean listenerOn() {
        return NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName());
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", listenerOn());
        call.resolve(r);
    }

    /** Opens the phone's Notification access screen. The app checks again when the landlord comes back. */
    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (listenerOn()) { status(call); return; }
        Intent i;
        if (Build.VERSION.SDK_INT >= 30) {
            i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS);
            i.putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
                    new ComponentName(getContext(), PaymentNotificationListener.class).flattenToString());
        } else {
            i = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
        } catch (Exception e) {
            // Some phones don't have the detail screen: fall back to the list.
            Intent list = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(list);
        }
        JSObject r = new JSObject();
        r.put("granted", false);
        r.put("opened", true);
        call.resolve(r);
    }

    /** Messages kept while the app was closed. They are cleared once handed over. */
    @PluginMethod
    public void getPending(PluginCall call) {
        JSONArray list = SmsStore.takeAll(getContext());
        JSArray out = new JSArray();
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o != null) out.put(o);
        }
        JSObject r = new JSObject();
        r.put("messages", out);
        call.resolve(r);
    }
}
