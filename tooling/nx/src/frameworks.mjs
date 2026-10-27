import fs from 'node:fs';
const toolchains = JSON.parse(
  fs.readFileSync(new URL('../../toolchains.json', import.meta.url), 'utf8'),
);
// Exact versions come from inspected upstream package/template metadata.
export function framework(o, pkg, put, target, targets, json) {
  if (o.technology === 'nextjs') {
    pkg.dependencies = {
      next: '16.4.1',
      react: '19.3.0',
      'react-dom': '19.3.0',
    };
    pkg.devDependencies = {
      '@types/react': '19.3.0',
      '@types/react-dom': '19.3.0',
    };
    delete pkg.exports;
    put(
      'app/page.tsx',
      `import {greet} from '../src/index';\nexport default function Page(){return <main><h1>{greet('${o.name}')}</h1></main>;}\n`,
    );
    put(
      'app/layout.tsx',
      `import type {ReactNode} from 'react';\nexport default function Layout({children}:{children:ReactNode}){return <html lang="en"><body>{children}</body></html>;}\n`,
    );
    put(
      'next.config.ts',
      `import type {NextConfig} from 'next';\nconst config:NextConfig={};\nexport default config;\n`,
    );
    put(
      'next-env.d.ts',
      '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n',
    );
    put(
      'tsconfig.json',
      json({
        extends: `${o.up}/tsconfig.base.json`,
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'react-jsx',
          noEmit: true,
          resolveJsonModule: true,
          plugins: [{ name: 'next' }],
        },
        include: [
          'next-env.d.ts',
          '**/*.ts',
          '**/*.tsx',
          '.next/types/**/*.ts',
        ],
        exclude: ['node_modules', 'dist'],
      }),
    );
    target('dev', 'pnpm exec next dev');
    target('build', 'pnpm exec next build', {
      outputs: ['{projectRoot}/.next'],
    });
    target('lint', 'pnpm exec eslint app src tests next.config.ts');
    put(
      'playwright.config.ts',
      `import {defineConfig} from '@playwright/test';\nexport default defineConfig({testDir:'./e2e',use:{baseURL:'http://localhost:3100'},webServer:{command:'pnpm exec next dev --port 3100',url:'http://localhost:3100',reuseExistingServer:!process.env.CI}});\n`,
    );
    put(
      'e2e/home.spec.ts',
      `import {test,expect} from '@playwright/test';\ntest('home greeting',async({page})=>{await page.goto('/');await expect(page.getByRole('heading')).toHaveText('hello, ${o.name}');});\n`,
    );
    target('e2e', 'pnpm exec playwright test');
  }
  if (o.technology === 'expo') {
    pkg.main = 'index.ts';
    delete pkg.exports;
    pkg.dependencies = {
      expo: '57.0.21',
      react: '19.2.3',
      'react-dom': '19.2.3',
      'react-native': '0.86.3',
      'expo-status-bar': '57.0.1',
    };
    pkg.devDependencies = { '@types/react': '19.2.2' };
    put(
      'index.ts',
      "import {registerRootComponent} from 'expo';\nimport App from './App';\nregisterRootComponent(App);\n",
    );
    put(
      'App.tsx',
      `import {Text,View} from 'react-native';\nimport {greet} from './src/index';\nexport default function App(){return <View><Text>{greet('${o.name}')}</Text></View>;}\n`,
    );
    put(
      'app.json',
      json({
        expo: {
          name: o.name,
          slug: o.name,
          version: '0.1.0',
          platforms: ['ios', 'android'],
        },
      }),
    );
    put(
      'tsconfig.json',
      json({
        extends: `${o.up}/tsconfig.base.json`,
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'react-jsx',
          noEmit: true,
          allowSyntheticDefaultImports: true,
        },
        include: ['**/*.ts', '**/*.tsx'],
        exclude: ['node_modules', 'dist'],
      }),
    );
    target('dev', 'pnpm exec expo start');
    target(
      'build',
      'pnpm exec expo export --platform android --output-dir dist',
      { outputs: ['{projectRoot}/dist'] },
    );
    target('lint', 'pnpm exec eslint App.tsx index.ts src tests');
    put(
      'MOBILE.md',
      '# Expo mobile application\n\nGenerated with the SDK-compatible dependency set from expo-template-blank-typescript 57.0.23. Metro supports workspace package imports. The build target exports an Android JS bundle; it does not claim a signed native application. Use Expo Go/dev builds and native Xcode/Android SDK for device validation. Configure explicit distribution only when needed.\n',
    );
  }
  if (o.database) {
    pkg.dependencies = {
      ...pkg.dependencies,
      'drizzle-orm': '0.45.2',
      postgres: '3.4.9',
    };
    put(
      'src/database/index.ts',
      "import postgres from 'postgres';\nimport {drizzle} from 'drizzle-orm/postgres-js';\nimport {z} from 'zod';\nexport function database(url:string){const client=postgres(z.url().parse(url));return {db:drizzle(client),close:()=>client.end()};}\n",
    );
  }
  if (o.queue) {
    pkg.dependencies = {
      ...pkg.dependencies,
      bullmq: '6.3.4',
      ioredis: '5.11.1',
    };
    put(
      'src/queue/index.ts',
      "import {Queue} from 'bullmq';\nimport {z} from 'zod';\nexport function queue(name:string,host:string,port=6379){return new Queue(z.string().min(1).parse(name),{connection:{host:z.string().min(1).parse(host),port:z.number().int().min(1).max(65535).parse(port)}});}\n",
    );
  }
  if (o.docker) {
    pkg.files = ['dist/src'];
    put(
      'Dockerfile',
      `FROM ${toolchains.nodeImage.reference} AS build\nWORKDIR /workspace\nCOPY . .\nRUN node tooling/scripts/install-pnpm.mjs --dir /opt/monorepo-bin\nENV PATH="/opt/monorepo-bin:$PATH"\nRUN pnpm install --frozen-lockfile --ignore-scripts && pnpm nx run ${o.id}:build && pnpm --filter ${pkg.name} deploy --prod --frozen-lockfile /out\n\nFROM ${toolchains.nodeImage.reference} AS runtime\nWORKDIR /app\nENV NODE_ENV=production HOST=0.0.0.0\nCOPY --from=build --chown=1000:1000 /out/ ./\nUSER 1000:1000\nCMD ["node", "dist/src/main.js"]\n`,
    );
    put(
      'DOCKER.md',
      `# Container packaging\n\nBuild from repository root: docker build -f ${o.root}/Dockerfile .\nUse a reviewed root .dockerignore before building; exclude .git, node_modules, local environments, credentials, models and generated outputs. Never send secret files in build context. The container binds HOST=0.0.0.0; local dev defaults to loopback. Publish only the intended local port, for example -p 127.0.0.1:3000:3000. Deployment remains explicit.\n`,
    );
    targets.package = {
      executor: 'nx:run-commands',
      options: {
        command: `docker build -f ${o.root}/Dockerfile -t monorepo-${o.id}:local .`,
      },
      cache: false,
    };
  }
}
