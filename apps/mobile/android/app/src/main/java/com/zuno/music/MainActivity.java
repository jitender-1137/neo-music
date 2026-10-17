package com.zuno.music;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins aren't npm packages, so Capacitor can't find them itself.
        registerPlugin(ZunoAudioPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
