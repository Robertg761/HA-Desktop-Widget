// Jest sets NODE_ENV to "test" only when the shell has not set it already. A shell or container
// with NODE_ENV=production then ran every suite down the production paths: src/ui-utils.js keys
// the synchronous dialog close on NODE_ENV, so dialogs stayed in .modal-closing and dozens of
// tests failed on a machine where CI passed. The suite always runs as a test run.
process.env.NODE_ENV = 'test';
