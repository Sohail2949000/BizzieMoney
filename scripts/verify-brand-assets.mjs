import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const brandAssets = [
  {
    path: new URL(
      '../apps/web/public/brand/bizziemoney-auth.png',
      import.meta.url,
    ),
    sha256: 'f7a9cb430ed84d2b56e94f8e502c1a827fe0d644c19f57d125a0fb07efc4bd73',
  },
  {
    path: new URL(
      '../apps/web/public/brand/bizziemoney-app.png',
      import.meta.url,
    ),
    sha256: 'c997e8f3d61d527c6c97ad591cc84d7b8ced2bb0e6d35114da6313eb6f04f309',
  },
  {
    path: new URL(
      '../apps/web/public/brand/bizziemoney-auth-lockup.png',
      import.meta.url,
    ),
    sha256: '1bd758458ae9ee52a223fa28ff1d99cd52bf67edcaa08ab684df8ed80735b872',
  },
  {
    path: new URL(
      '../apps/web/public/brand/bizziemoney-app-lockup.png',
      import.meta.url,
    ),
    sha256: '2e34ea7bd66623dcc1854c0f65478ae1722fa6784f77b93e49455e15edae71b4',
  },
  {
    path: new URL(
      '../apps/web/public/brand/bizziemoney-auth-light.png',
      import.meta.url,
    ),
    sha256: 'f157957de516f4397b3b764d562c12609bebed478b6fa26d8759ddebf5f76aa5',
  },
  {
    path: new URL(
      '../apps/web/public/brand/bizziemoney-auth-dark.png',
      import.meta.url,
    ),
    sha256: 'ffff374cea59ca71446f1e6a34a964dcc1b91a02304dab1abb26b9f5337844cb',
  },
  {
    path: new URL(
      '../apps/web/public/brand/bizziemoney-app-light.png',
      import.meta.url,
    ),
    sha256: '0a1ce5cfcbbdc4b6353daeee35d7304fb8bb4233229f869b328daeda133f63d6',
  },
  {
    path: new URL(
      '../apps/web/public/brand/bizziemoney-app-dark.png',
      import.meta.url,
    ),
    sha256: '72bdb7dcf171cbc7cf2704d8fd332710cd49c6a882c3a1d8c891213afbf03a21',
  },
  {
    path: new URL(
      '../apps/web/public/brand/bizziemoney-auth-light-display.png',
      import.meta.url,
    ),
    sha256: '8bf1dc9ba239584c0a47f49d02b862b6cebafcf07c320689cc2a22c24289d0d8',
  },
  {
    path: new URL(
      '../apps/web/public/brand/bizziemoney-auth-dark-display.png',
      import.meta.url,
    ),
    sha256: '022fe09ab7e43f4240c22b0b6404f94fda97453f7bb7c0decde8f20e0a52d2d9',
  },
  {
    path: new URL(
      '../apps/web/public/brand/bizziemoney-app-light-display.png',
      import.meta.url,
    ),
    sha256: 'ecd85026c61a6525cb231087d187e06e047a101cf31ad18d10dedcea850d9ebc',
  },
  {
    path: new URL(
      '../apps/web/public/brand/bizziemoney-app-dark-display.png',
      import.meta.url,
    ),
    sha256: '986a5fdf0690d747ac770b4cf1875ce2a4f86fbadb5bfab210c6a3c1ff54598a',
  },
];

for (const asset of brandAssets) {
  const file = await readFile(asset.path);
  const actual = createHash('sha256').update(file).digest('hex');
  if (actual !== asset.sha256) {
    throw new Error(
      `Protected BizzieMoney brand asset changed: ${asset.path.pathname}.`,
    );
  }
}
