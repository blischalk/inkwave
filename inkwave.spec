# -*- mode: python ; coding: utf-8 -*-
import os
import sys
import importlib.util

block_cipher = None

# Icon paths (optional — build succeeds without them)
icon_mac = 'icon.icns' if os.path.exists('icon.icns') else None
icon_win = 'icon.ico'  if os.path.exists('icon.ico')  else None

# Collect data files that PyInstaller misses for packages with non-Python assets.
def _pkg_dir(name):
    spec = importlib.util.find_spec(name)
    return os.path.dirname(spec.origin) if spec else None

extra_datas = []
_rfc = _pkg_dir('rfc3987_syntax')
if _rfc:
    extra_datas.append((_rfc, 'rfc3987_syntax'))

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('index.html', '.'),
        ('style.css',  '.'),
        ('js',         'js'),
        ('vendor',     'vendor'),
        ('Welcome.md', '.'),
    ] + extra_datas,
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
        argv_emulation=True,
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
            'NSLocalNetworkUsageDescription': 'Inkwave uses a local connection to display content. AI chat features require internet access.',
            'CFBundleDocumentTypes': [
                {
                    'CFBundleTypeName': 'Markdown Document',
                    'CFBundleTypeRole': 'Editor',
                    'LSHandlerRank': 'Default',
                    'LSItemContentTypes': ['net.daringfireball.markdown'],
                    'CFBundleTypeExtensions': ['md', 'markdown'],
                },
            ],
            'UTImportedTypeDeclarations': [
                {
                    'UTTypeIdentifier': 'net.daringfireball.markdown',
                    'UTTypeDescription': 'Markdown Document',
                    'UTTypeConformsTo': ['public.plain-text'],
                    'UTTypeTagSpecification': {
                        'public.filename-extension': ['md', 'markdown'],
                    },
                },
            ],
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
