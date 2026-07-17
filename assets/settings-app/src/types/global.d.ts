interface PyBridge {
    get_saved_credentials: (callback: (credsStr: string) => void) => void;
    get_local_ips: (callback: (ipsStr: string) => void) => void;
    clear_credentials: () => Promise<void>;
    save_global_credentials: (credsStr: string, callback: (resStr: string) => void) => void;
}

interface Window {
    qt: any;
    QWebChannel: any;
    pyBridge: PyBridge;
}
