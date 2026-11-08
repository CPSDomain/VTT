// Sets the icon and version details on the Windows .exe without needing Windows or Wine.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const { productName } = context.packager.appInfo;
  const version = context.packager.appInfo.version.split('.').map(Number);
  const exePath = path.join(context.appOutDir, `${productName}.exe`);

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const target = groups[0] || { id: 1, lang: 1033 };
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, target.id, target.lang, ico.icons.map((i) => i.data));

  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  const langs = vi.getAllLanguagesForStringValues();
  const lang = langs[0] || { lang: 1033, codepage: 1200 };
  vi.setStringValues(lang, {
    ProductName: productName, FileDescription: productName, CompanyName: 'Tabletop',
    InternalName: productName, OriginalFilename: `${productName}.exe`, LegalCopyright: ''
  });
  vi.setFileVersion(version[0], version[1], version[2], 0, lang.lang);
  vi.setProductVersion(version[0], version[1], version[2], 0, lang.lang);
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • set icon and version info on ${productName}.exe`);
};
