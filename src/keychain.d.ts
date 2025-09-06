declare module 'keychain' {
  interface KeychainOptions {
    account: string;
    service: string;
    password?: string;
    type?: 'generic' | 'internet';
    keychainName?: string;
  }

  interface KeychainCallback {
    (err: Error | null, password?: string): void;
  }

  interface KeychainAPI {
    setPassword(options: KeychainOptions, callback?: KeychainCallback): void;
    getPassword(options: KeychainOptions, callback: KeychainCallback): void;
    deletePassword(options: KeychainOptions, callback?: KeychainCallback): void;
    createKeychain(options: KeychainOptions, callback?: KeychainCallback): void;
    deleteKeychain(options: KeychainOptions, callback?: KeychainCallback): void;
    setDefaultKeychain(options: KeychainOptions, callback?: KeychainCallback): void;
  }

  const keychain: KeychainAPI;
  export default keychain;
}
