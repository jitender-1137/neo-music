import Capacitor
import UIKit

/** Registers the app's local plugins (they aren't npm packages, so Capacitor can't find them itself). */
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ZunoAudioPlugin())
    }
}
