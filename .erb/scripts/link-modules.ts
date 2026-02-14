import fs from 'fs';
import webpackPaths from '../configs/webpack.paths';

const { srcNodeModulesPath } = webpackPaths;
const { appNodeModulesPath } = webpackPaths;

if (fs.existsSync(appNodeModulesPath)) {
  // Remove existing symlink or directory if it exists
  if (fs.existsSync(srcNodeModulesPath)) {
    const stats = fs.lstatSync(srcNodeModulesPath);
    if (stats.isSymbolicLink()) {
      // Symlink already exists, skip
      console.log('Symlink already exists, skipping...');
    } else {
      // It's a real directory, don't touch it
      console.log('Real directory exists at srcNodeModulesPath, skipping...');
    }
  } else {
    fs.symlinkSync(appNodeModulesPath, srcNodeModulesPath, 'junction');
    console.log('Created symlink from', appNodeModulesPath, 'to', srcNodeModulesPath);
  }
}
