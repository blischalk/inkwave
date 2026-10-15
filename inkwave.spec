# -*- mode: python ; coding: utf-8 -*-
import os
import sys
import importlib.util

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

block_cipher = None

# Dev build isolation — set INKWAVE_DEV_BUILD=1 (via build-dev.sh) to produce
# an installable .app with a distinct bundle identifier, display name, and
# executable name, so it never shares production's settings.json or WebKit
# storage profile (both keyed by bundle identifier on macOS). Default (unset)
# produces byte-identical output to the pre-existing production build.
#
# _DEV_APP_NAME ("Inkwave-Dev") must match app.py's _DEV_APP_NAME constant —
# .spec files cannot import app.py at analysis time, so the match is locked
# in by tests/python/test_build_dev.py's exact-string-match assertions
# rather than shared code.
_is_dev_build = os.environ.get('INKWAVE_DEV_BUILD') == '1'
_bundle_id    = 'com.inkwave.app.dev' if _is_dev_build else 'com.inkwave.app'
_display_name = 'Inkwave (Dev)'       if _is_dev_build else 'Inkwave'
_exe_name     = 'Inkwave-Dev'         if _is_dev_build else 'Inkwave'

# PDF export (pdf_export.py) pulls in pygments, reportlab and svglib. Pygments
# loads lexers/styles by dynamic import, which PyInstaller's static analysis
# cannot follow, and reportlab ships font data files — collect both explicitly.
pdf_hiddenimports = (
    collect_submodules('pygments.lexers')
    + collect_submodules('pygments.styles')
    + collect_submodules('pygments.formatters')
)
pdf_datas = collect_data_files('reportlab')

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

# Dev-build marker: an empty sentinel file bundled alongside app.py's BASE_DIR
# so the frozen app can detect "I am a dev build" at runtime via a presence
# check (app._is_dev_build()). Content is never parsed — presence-only check
# avoids any JSON/text parsing failure mode.
if _is_dev_build:
    _devbuild_marker_path = os.path.join(os.path.dirname(os.path.abspath(SPEC)), '_devbuild')
    with open(_devbuild_marker_path, 'w', encoding='utf-8') as _f:
        _f.write('')
    extra_datas.append((_devbuild_marker_path, '.'))

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
        ('./._/.definitely/.not.an.easter.egg', './._/.definitely/.not.an.easter.egg'),
        ('pdf_export.py', '.'),
    ] + extra_datas + pdf_datas,
    hiddenimports=['webview', 'pygame', 'cydoomgeneric', 'pdf_export'] + pdf_hiddenimports,
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
        name=_exe_name,
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
        name=_exe_name,
    )
    app = BUNDLE(
        coll,
        name=_exe_name + '.app',
        icon=icon_mac,
        bundle_identifier=_bundle_id,
        info_plist={
            'CFBundleName':             _exe_name,
            'CFBundleDisplayName':      _display_name,
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
        name=_exe_name,
        debug=False,
        strip=False,
        upx=True,
        upx_exclude=[],
        runtime_tmpdir=None,
        console=False,
        icon=icon_win,
    )
