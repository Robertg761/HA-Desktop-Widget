const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
const start = mainSource.indexOf('function describeOperatingSystem');
const describeSource = mainSource.slice(start, mainSource.indexOf('\n}\n', start) + 3);

function describeWith({ platform, release, osRelease, systemVersion }) {
  const context = {
    process: { getSystemVersion: () => systemVersion },
    os: {
      platform: () => platform,
      release: () => release,
      hostname: jest.fn(() => 'private-host'),
      userInfo: jest.fn(() => ({ username: 'private-user' })),
    },
    fs: {
      readFileSync: jest.fn(() => {
        if (osRelease === undefined) throw new Error('ENOENT');
        return osRelease;
      }),
    },
  };
  vm.runInNewContext(describeSource, context);
  return { info: vm.runInNewContext('describeOperatingSystem()', context), context };
}

describe('operating system details for the diagnostics report', () => {
  it('names the Linux distribution and kernel release, not the computer or user', () => {
    const { info, context } = describeWith({
      platform: 'linux',
      release: '6.8.0-45-generic',
      osRelease: 'NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\nID=ubuntu\n',
    });
    expect(info).toEqual({
      platform: 'linux',
      release: '6.8.0-45-generic',
      distro: 'Ubuntu 24.04.1 LTS',
    });
    expect(context.os.hostname).not.toHaveBeenCalled();
    expect(context.os.userInfo).not.toHaveBeenCalled();
  });

  it('still reports the kernel release without /etc/os-release', () => {
    expect(describeWith({ platform: 'linux', release: '6.1.0' }).info).toEqual({
      platform: 'linux',
      release: '6.1.0',
    });
  });

  it('names Windows 11 by its build, since it still reports kernel 10.0', () => {
    const { info, context } = describeWith({ platform: 'win32', release: '10.0.26100' });
    expect(info).toEqual({ platform: 'win32', release: '10.0.26100', distro: 'Windows 11' });
    expect(context.fs.readFileSync).not.toHaveBeenCalled();
  });

  it('names Windows 10 for builds before 22000', () => {
    expect(describeWith({ platform: 'win32', release: '10.0.19045' }).info.distro).toBe(
      'Windows 10'
    );
  });

  it('names macOS by its product version, not the Darwin kernel', () => {
    const { info } = describeWith({
      platform: 'darwin',
      release: '25.0.0',
      systemVersion: '26.0.1',
    });
    expect(info).toEqual({ platform: 'darwin', release: '25.0.0', distro: 'macOS 26.0.1' });
  });

  it('reports other systems by platform and release only', () => {
    expect(describeWith({ platform: 'freebsd', release: '14.1' }).info).toEqual({
      platform: 'freebsd',
      release: '14.1',
    });
  });
});
