# -*- mode: python ; coding: utf-8 -*-
import os
import sys

block_cipher = None

# Icon paths (optional — build succeeds without them)
icon_mac = 'icon.icns' if os.path.exists('icon.icns') else None
icon_win = 'icon.ico'  if os.path.exists('icon.ico')  else None

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('index.html', '.'),
        ('style.css',  '.'),
        ('app.js',     '.'),
        ('Welcome.md', '.'),
    ],
    hiddenimports=['webview'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

if sys.platform == 'darwin':
    exe = EXE(
        pyz,
        a.scripts,
        [],
        exclude_binaries=True,
        name='Inkwave',
        debug=False,
        strip=False,
        upx=True,
        console=False,
        icon=icon_mac,
    )
    coll = COLLECT(
        exe,
        a.binaries,
        a.zipfiles,
        a.datas,
        strip=False,
        upx=True,
        upx_exclude=[],
        name='Inkwave',
    )
    app = BUNDLE(
        coll,
        name='Inkwave.app',
        icon=icon_mac,
        bundle_identifier='com.inkwave.app',
        info_plist={
            'CFBundleName':             'Inkwave',
            'CFBundleDisplayName':      'Inkwave',
            'CFBundleShortVersionString': '1.0.0',
            'CFBundleVersion':          '1.0.0',
            'NSHighResolutionCapable':  True,
            'NSRequiresAquaSystemAppearance': False,
        },
    )

else:
    # Windows — single-file exe
    exe = EXE(
        pyz,
        a.scripts,
        a.binaries,
        a.zipfiles,
        a.datas,
        [],
        name='Inkwave',
        debug=False,
        strip=False,
        upx=True,
        upx_exclude=[],
        runtime_tmpdir=None,
        console=False,
        icon=icon_win,
    )
