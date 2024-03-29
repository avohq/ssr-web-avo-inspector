# SSR and Web Workers Avo Inspector

[![npm version](https://badge.fury.io/js/ssr-web-avo-inspector.svg)](https://badge.fury.io/js/ssr-web-avo-inspector)

This is a special build for server side rendering and web workers. If you don't need those features use the [main library](https://github.com/avohq/js-avo-inspector)

# Avo documentation

This is a quick start guide.
For more information about the Inspector project please read [Avo documentation](https://www.avo.app/docs/implementation/inspector/sdk/web).

# Installation

The library is distributed with npm

```
    npm i ssr-web-avo-inspector
```

or

```
    yarn add ssr-web-avo-inspector
```

# Initialization

Obtain the API key at [Avo.app](https://www.avo.app/welcome)

```javascript
import * as Inspector from "ssr-web-avo-inspector";

let inspector = new Inspector.AvoInspector({
  apiKey: "your api key",
  env: Inspector.AvoInspectorEnv.Dev,
  version: "1.0.0",
  appName: "My app",
  suffix: "instance0"
});
```

# Enabling logs

Logs are enabled by default in the dev mode and disabled in prod mode.

```javascript
inspector.enableLogging(true);
```

# Integrating with Avo Codegen (Avo generated code)

The setup is lightweight and is covered [in this guide](https://www.avo.app/docs/implementation/start-using-inspector-with-avo-functions).

Every event sent with Avo Function after this integration will automatically be sent to the Avo Inspector.

# Sending event schemas for events reported outside of Avo Codegen

Whenever you send tracking event call one of the following methods:

Read more in the [Avo documentation](https://www.avo.app/docs/implementation/devs-101#inspecting-events)

### 1.

This method gets actual tracking event parameters, extracts schema automatically and sends it to the Avo Inspector backend.
It is the easiest way to use the library, just call this method at the same place you call your analytics tools' track methods with the same parameters.

```javascript
inspector.trackSchemaFromEvent("Event name", {
  "String Prop": "Prop Value",
  "Float Prop": 1.0,
  "Boolean Prop": true,
});
```

### 2.

If you prefer to extract data schema manually you would use this method.

```javascript
inspector.trackSchema("Event name", [
  { propertyName: "String prop", propertyType: "string" },
  { propertyName: "Float prop", propertyType: "float" },
  { propertyName: "Boolean prop", propertyType: "boolean" },
]);
```

# Extracting event schema manually

```javascript
let schema = inspector.extractSchema({
  "String Prop": "Prop Value",
  "Float Prop": 1.0,
  "Boolean Prop": true,
});
```

You can experiment with this method to see how more complex schemas look, for example with nested lists and objects.

# Batching control

In order to ensure our SDK doesn't have a large impact on performance or battery life it supports event schemas batching.

Default batch size is 30 and default batch flush timeout is 30 seconds.
In development mode batching is disabled.

```javascript
inspector.setBatchSize(15);
inspector.setBatchFlushSeconds(10);
```

# Developing

If you find anything could be improved or added to this package we welcome your contributions. 

## Getting started

To make changes you'll need to have a recent version of Node installed and Yarn (version 1) to install (and update, if need) the proper packages. Run `yarn install` to install the dependencies and `yarn build` to compile the TypeScript files. 

## Making changes

While you're developing you can use the watch mode to compile your files while you're editing: `yarn build --watch`. Once you've made your changes run `yarn test` to make sure the tests pass. If you've added new functionality please add tests for it as well. Once you're happy with your changes please open a PR.

## Publishing

When you have unpublished changes on the main branch that you want to get out to the world you can publish a new version. Pull the latest version and run `yarn build` followed by `npm publish`. Note that this is only an option for members of the Avo team. Add a summary of the changes from the last version to the changelog, make a commit with the increased version number called `Release x.y.z` and tag it with the same version number (`x.y.z`). 

## Author

Avo (https://www.avo.app), friends@avo.app

## License

AvoInspector is available under the MIT license.
