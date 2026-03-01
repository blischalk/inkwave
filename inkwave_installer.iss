[Setup]
AppName=Inkwave
AppVersion=1.0.0
AppPublisher=Inkwave
DefaultDirName={autopf}\Inkwave
DefaultGroupName=Inkwave
OutputDir=dist
OutputBaseFilename=InkwaveSetup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
; Uncomment and set path to sign the installer:
; SignTool=signtool

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
Source: "dist\Inkwave.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Inkwave";        Filename: "{app}\Inkwave.exe"
Name: "{group}\Uninstall Inkwave"; Filename: "{uninstallexe}"
Name: "{commondesktop}\Inkwave"; Filename: "{app}\Inkwave.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Inkwave.exe"; Description: "Launch Inkwave"; Flags: nowait postinstall skipifsilent
