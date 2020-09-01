import { Observable } from '@nativescript/core';
import { EventData } from "@nativescript/core/data/observable";
import { ObservableArray } from "@nativescript/core/data/observable-array";

import { alert } from "@nativescript/core/ui/dialogs";
import * as dialogs from "@nativescript/core/ui/dialogs";
import { TextView } from "@nativescript/core/ui/text-view";

import * as nsutils from '@nativescript/core/utils/utils';
import { ios } from '@nativescript/core/application';

import * as  appSettings from "@nativescript/core/application-settings";
import * as clipboard from "nativescript-clipboard";

import { Nfc, NfcTagData, NfcNdefData } from "nativescript-nfc";
import CryptoES from 'crypto-es';

import { SeedItem } from "~/common/interfaces";
import { encryptSeedLabel, encryptSeedLabelMessage } from "~/common/constants";

export class CryptoVaultModel extends Observable {
    public lastNdefDiscovered: string = "Press a button...";
    private nfc: Nfc;
    public seed: string = "";
    public seedList: ObservableArray<Object>;
    public static getSeedList: ObservableArray<Object>;

    constructor() {
        super();
        this.nfc = new Nfc();
        this.seed = "empty";

        this.seedList = new ObservableArray([]);
        CryptoVaultModel.getSeedList = this.seedList;

        this.getSeedListSettings().map(function (seed: Object) {
            let data: SeedItem = seed;
            this.seedList.unshift({ name: data.name, encryptedSeed: data.encryptedSeed, decrypt: this.decryptSeedItem, remove: this.removeSeedItem });
        }, this);
    }

    public doCheckAvailable() {
        this.nfc.available().then((avail) => {
            console.log("Available? " + avail);
            alert("" + avail);
        }, (err) => {
            alert(err);
        });
    }

    public doCheckEnabled() {
        this.nfc.enabled().then((on) => {
            console.log("Enabled? " + on);
            alert("" + on);
        }, (err) => {
            alert(err);
        });
    }

    public doStartTagListener() {
        let that = this;
        this.nfc.setOnTagDiscoveredListener((data: NfcTagData) => {
            console.log("Tag discovered! " + data.id);
            that.set("lastTagDiscovered", data.id);
        }).then(() => {
            console.log("OnTagDiscovered Listener set");
        }, (err) => {
            console.log(err);
        });
    }

    public doStopTagListener() {
        this.nfc.setOnTagDiscoveredListener(null).then(() => {
            console.log("OnTagDiscovered nulled");
        }, (err) => {
            console.log(err);
        });
    }

    public doStartNdefListener() {
        this.nfc.setOnNdefDiscoveredListener((data: NfcNdefData) => {
            if (data.message) {
                // data.message is an array of records, so:
                data.message.forEach(record => {
                    console.log("Read record: " + JSON.stringify(record));
                    let data: SeedItem = JSON.parse(record.payloadAsString);
                    if (CryptoVaultModel.searchSeedKey(data.encryptedSeed) != undefined) {
                        // Tag already exists
                        alert("The scanned tag matched with existing seed: " + data.name);
                    }
                    else {
                        // Import new tag
                        dialogs.confirm({
                            title: "New seed detected",
                            message: "New encrypted seed detected! Import now?",
                            okButtonText: "Import",
                            cancelButtonText: "Cancel"
                        }).then(r => {
                            // result argument is boolean
                            console.log("Dialog result: " + r);
                            if (r != false) {
                                this.seedList.unshift({ name: data.name, encryptedSeed: data.encryptedSeed, decrypt: this.decryptSeedItem, remove: this.removeSeedItem });
                                CryptoVaultModel.updateSeedListSettings();
                                this.set("lastNdefDiscovered", "Read: " + record.payloadAsString);
                                alert("New seed import successful!");
                            }
                        });
                    }
                });
            }
        }, {
            stopAfterFirstRead: true,
            scanHint: "Scan a tag, baby!"
        })
            .then(() => this.set("lastNdefDiscovered", "Listening..."))
            .catch(err => alert(err));
    }

    public doStopNdefListener() {
        this.nfc.setOnNdefDiscoveredListener(null).then(() => {
            this.set("lastNdefDiscovered", "Stopped listening.");
        }, (err) => {
            alert(err);
        });
    }

    public doWriteText(args: EventData) {
        const decryptItem = args.object as TextView;

        // Parent object
        let _this = (args.object as TextView).page.bindingContext;

        dialogs.confirm({
            title: "Write seed to NFC",
            message: "Tap and hold your NFC tag near your device, press 'Write NFC' when ready!",
            okButtonText: "Write NFC",
            cancelButtonText: "Cancel"
        }).then(r => {
            // result argument is boolean
            console.log("Dialog result: " + r);
            if (r != false) {
                let data: SeedItem = {};
                data = CryptoVaultModel.getSeedList.getItem(CryptoVaultModel.searchSeedKey(decryptItem.id)) || ""; // Pass which tag to write

                _this.nfc.writeTag({
                    textRecords: [
                        {
                            id: [1],
                            text: JSON.stringify(data) || "{}"
                        }
                    ]
                }).then(() => {
                    _this.set("lastNdefDiscovered", "NFC tag updated, wrote encrypted seed phrase!");
                    alert("NFC tag updated, wrote encrypted seed phrase!");
                }, (err) => {
                    console.log(err);
                });
            }
        });
    }

    public doWriteUri() {
        this.nfc.writeTag({
            uriRecords: [
                {
                    id: [2, 5],
                    uri: "https://www.telerik.com"
                }
            ]
        }).then(() => {
            this.set("lastNdefDiscovered", "Wrote uri 'https://www.telerik.com");
        }, (err) => {
            console.log(err);
        });
    }

    public doEraseTag() {
        this.nfc.eraseTag().then(() => {
            this.set("lastNdefDiscovered", "Tag erased");
        }, (err) => {
            console.log(err);
        });
    }

    /**
     * Capture when new seed value is typed
     */
    public onSeedChange(args: EventData) {
        const seedFromInput = args.object as TextView;
        this.seed = seedFromInput.text;
    }

    /**
     * Encrypt and write to the NFC chip
     */
    public encryptSeed() {

        // Prevent keyboard stuck open
        this.hideKeyboard();

        dialogs.prompt({
            title: encryptSeedLabel,
            message: encryptSeedLabelMessage,
            okButtonText: "Encrypt",
            cancelButtonText: "Cancel",
            defaultText: "",
            inputType: dialogs.inputType.password
        }).then(r => {
            if (r.result != false) {
                let ciphertext = CryptoES.AES.encrypt(this.seed, r.text);
                this.seedList.unshift({ name: '#' + (CryptoVaultModel.getSeedList.length + 1), encryptedSeed: ciphertext.toString(), decrypt: this.decryptSeedItem, remove: this.removeSeedItem });
                CryptoVaultModel.updateSeedListSettings();
            }
        });
    }

    public getSeedListSettings(): Array<string> {
        return JSON.parse(appSettings.getString("seeds", "[]"));
    }

    public static updateSeedListSettings(): void {
        let updatedItems: Array<Object> = [];
        CryptoVaultModel.getSeedList.map(function (seed: Object) {
            updatedItems.unshift(seed);
        });
        appSettings.setString("seeds", JSON.stringify(updatedItems));
    }

    public decryptSeedItem(args: EventData) {
        const decryptItem = args.object as TextView;

        dialogs.prompt({
            title: "Decrypt seed",
            message: "Use the password you provided earlier for this seed",
            okButtonText: "Decrypt",
            cancelButtonText: "Cancel",
            defaultText: "",
            inputType: dialogs.inputType.password
        }).then(r => {
            if (r.result != false) {
                let ciphertext = CryptoES.AES.decrypt(decryptItem.id, r.text);

                dialogs.confirm({
                    title: "Decrypted seed",
                    message: ciphertext.toString(CryptoES.enc.Utf8),
                    okButtonText: "Copy to clipboard",
                    cancelButtonText: "Ok"
                }).then(r => {
                    // result argument is boolean
                    console.log("Dialog result: " + r);
                    if (r != false) {
                        clipboard.setText(ciphertext.toString(CryptoES.enc.Utf8)).then(function () {
                            alert('Saved to clipboard');
                        })
                    }
                });
            }

        });
    }

    public removeSeedItem(args: EventData) {
        const removeItem = args.object as TextView;
        CryptoVaultModel.getSeedList.splice(CryptoVaultModel.searchSeedKey(removeItem.id), 1);
        CryptoVaultModel.updateSeedListSettings();
    }

    public static searchSeedKey(encryptedSeed: string): number {
        for (let i = 0; i < CryptoVaultModel.getSeedList.length; i++) {
            let data: SeedItem = {};
            data = CryptoVaultModel.getSeedList.getItem(i);
            if (data.encryptedSeed != undefined && data.encryptedSeed == encryptedSeed) {
                return i;
            }
        }
        return undefined;
    }

    public hideKeyboard() {
        if (ios) {
            ios.nativeApp.sendActionToFromForEvent('resignFirstResponder', null, null, null);
        } else {
            nsutils.ad.dismissSoftInput();
        }
    }
}