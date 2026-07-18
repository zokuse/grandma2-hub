# GrandMA2 Hub

An all-in-one companion app for GrandMA2 lighting programmers. Connect directly to your console, automate patch/layout workflows, and manage 3D assets effortlessly.

## Features
- **Direct Console Connection**: Push commands and macros directly to MA2 via Telnet.
- **Automate Workflows**: Extract and push XYZ positions, patches, and layouts from XML/Capture files.
- **Macro Manager**: Generate and deploy custom macros over the network.
- **3D Assets**: Unpack and manage `.glb` and `.gltf` files for your 3D environment.
- **PDF Reports**: Export professional A4/A5 fixture spec and patch reports.

## Getting Started

1. Install [Node.js](https://nodejs.org/)
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the app:
   ```bash
   npm start
   ```

## Build Executable
To create a Windows installer (`.exe`):
```bash
npm run build-installer
```
