package com.voltatech.landlordhub;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsReaderPlugin.class);
        super.onCreate(savedInstanceState);
        takeShared(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        takeShared(intent);
    }

    /** "Share → Landlord Hub" on a payment SMS: keep it for the landlord to check.
     *  Any app can share text here, so it is marked "shared" and never recorded without the landlord confirming. */
    private void takeShared(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text != null && SmsStore.looksLikeMoneyIn(text)) SmsStore.add(this, "shared", text, System.currentTimeMillis());
    }
}
