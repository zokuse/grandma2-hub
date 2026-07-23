# GrandMA2 Hub

![Version](https://img.shields.io/github/package-json/v/zokuse/grandma2-hub?color=fdd835&style=flat-square)
![License](https://img.shields.io/github/license/zokuse/grandma2-hub?color=00e676&style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows-29b6f6?style=flat-square)

A desktop companion tool built for MA Lighting GrandMA2 programmers. It seamlessly connects to your console via Telnet and Art-Net to automate tedious patch workflows, generate timecode shows, monitor live network traffic, and manage 3D pre-viz assets.

> **Note:** This is an independent, third-party personal workflow utility shared with the community. It is not affiliated with, endorsed by, or associated with MA Lighting in any way. Use it at your own risk.

---

## Workspace Features

- **Art-Net Viewer**
  Monitor live Art-Net traffic on your network in real-time. Features a heat-mapped 512-channel DMX grid, smart network adapter binding, Node discovery via ArtPoll, and a fluid packets-per-second chart.
- **Visual Cloner**
  Visually map clone sources to destinations from your layouts and automatically push the generated clone macros straight to the console.
- **DMX View**
  A visual footprint of your universes. Check channel occupancy, fixture counts, and color-coded layers at a glance.
- **Patch List**
  Pull your current patch directly from the console and export clean, professional PDF reports for your crew and technicians.
- **XYZ Injector**
  Map real-world 3D spatial coordinates from pre-viz software (like Capture) directly into your MA2 patch for pixel-perfect 3D environments.
- **Timecode Cues**
  Generate MA2 XML timecode shows directly from REAPER `.rpp` project markers with auto-assigned sequences.
- **glTF Unpacker**
  Easily unpack, extract textures, and manage `.glb`/`.gltf` 3D model files for MA2 3D environment integration.

---

## Development Setup

Ensure you have [Node.js](https://nodejs.org/) installed on your machine.

**1. Clone the repository and install dependencies:**
```bash
git clone https://github.com/zokuse/grandma2-hub.git
cd grandma2-hub
npm install
```

**2. Run the application in development mode:**
```bash
npm start
```

**3. Build a production Windows Installer (.exe):**
```bash
npm run build-installer
```
*The packaged executable installer will be generated inside the `dist/` directory.*

---

## License

This project is open-source and licensed under the [MIT License](LICENSE).
