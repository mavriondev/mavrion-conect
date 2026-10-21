#!/bin/bash
set -e

for pkg_file in package.json norion-standalone/package.json; do
  if [ -f "$pkg_file" ]; then
    echo "Cleaning $pkg_file..."
    
    if grep -q "@replit" "$pkg_file"; then
      node -e "
        const fs = require('fs');
        const pkg = JSON.parse(fs.readFileSync('$pkg_file', 'utf8'));
        
        for (const section of ['dependencies', 'devDependencies']) {
          if (pkg[section]) {
            for (const key of Object.keys(pkg[section])) {
              if (key.startsWith('@replit/')) {
                console.log('  Removing:', key, 'from', section);
                delete pkg[section][key];
              }
            }
          }
        }
        
        if (pkg.dependencies && !pkg.dependencies.googleapis) {
          pkg.dependencies.googleapis = '^148.0.0';
          console.log('  Added: googleapis to dependencies');
        }
        
        fs.writeFileSync('$pkg_file', JSON.stringify(pkg, null, 2) + '\n');
        console.log('  Done:', '$pkg_file');
      "
    else
      echo "  No @replit deps found in $pkg_file"
    fi
  fi
done

echo "All Replit dependencies removed."
