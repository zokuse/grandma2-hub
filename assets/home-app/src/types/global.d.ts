interface PyBridge {
    switch_to: (tab: string) => void;
}

interface Window {
    qt: any;
    QWebChannel: any;
    pyBridge: PyBridge;
}
