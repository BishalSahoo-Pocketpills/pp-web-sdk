import type { PPLibConfig } from '@src/types/common.types';

export function createConfig(): PPLibConfig {
  return {
    debug: false,
    verbose: false,
    namespace: 'pp_attr',

    security: {
      maxParamLength: 500,
      maxStorageSize: 4096,
      maxUrlLength: 2048,
      enableSanitization: true,
      strictMode: false
    }
  };
}
