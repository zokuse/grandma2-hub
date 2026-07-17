# GrandMA2 Hub

**GrandMA2 Hub** is an advanced Electron-based desktop application designed as an all-in-one companion utility for GrandMA2 lighting programmers. It streamlines workflows by connecting directly to the console and automating tedious tasks involving patching, 3D positioning, macros, and reporting.

## Key Features

*   **Direct Console Integration (Telnet)**
    *   Connects directly to your GrandMA2 console or onPC via Telnet.
    *   Push commands, macros, and data directly into the programmer without manual importing.
*   **Patch, Layout & Capture XML Parsing**
    *   Pull *Patch* and *Layout* data directly from the active showfile.
    *   Import and parse GrandMA2 XMLs or **Capture** XML exports.
    *   Extract fixture IDs, DMX addresses, and 3D XYZ coordinates automatically.
*   **3D XYZ Position Automation**
    *   Automatically generate and push XYZ position data directly to fixtures in the MA2 3D environment based on parsed layouts or Capture files.
*   **Macro Generation & Deployment**
    *   Create custom macros and export them as XML.
    *   Send generated macros directly to the console's macro pool over the network.
*   **GLTF/GLB 3D Asset Management**
    *   Built-in tools to analyze and unpack `.glb` and `.gltf` 3D files.
    *   Extract and manage textures for 3D stage environments.
*   **PDF Reporting & Documentation**
    *   Generate professional PDF reports (e.g., Fixture Specs, Weight & Wattage data).
    *   Supports A4 and A5 (2-up) layouts for easy printing.

## Getting Started

### Prerequisites
*   [Node.js](https://nodejs.org/) installed on your machine.
*   A GrandMA2 console or onPC software running on the same network (for Telnet features).

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/zokuse/grandma2-hub.git
    cd grandma2-hub
    ```
2.  **Install Dependencies**
    ```bash
    npm install
    ```
3.  **Run the Application**
    ```bash
    npm start
    ```

### Building the Executable (Windows)
To package the app into a standalone `.exe` file for Windows:
```bash
npm run build-exe
```
*The compiled application will be available in the `dist` folder.*

## Technology Stack
*   **Frontend**: React, Vite, Tailwind CSS (via sub-apps in `assets/`), Three.js for 3D processing.
*   **Backend**: Node.js, Electron (IPC Main).
*   **Utilities**: `fast-xml-parser` for MA2 XML manipulation, `pdf-lib` for reporting.
