# @anuradev/capacitor-background-mode

Capacitor plugin to enable background mode

This plugin replace to [capacitor-plugin-background-mode](https://github.com/angeloraso/capacitor-plugin-background-mode)

## Install

```bash
npm install @anuradev/capacitor-background-mode
npx cap sync
```

## API

<docgen-index>

* [`enable()`](#enable)
* [`disable()`](#disable)
* [`getSettings()`](#getsettings)
* [`setSettings(...)`](#setsettings)
* [`checkForegroundPermission()`](#checkforegroundpermission)
* [`requestForegroundPermission()`](#requestforegroundpermission)
* [`checkNotificationsPermission()`](#checknotificationspermission)
* [`requestNotificationsPermission()`](#requestnotificationspermission)
* [`checkBatteryOptimizations()`](#checkbatteryoptimizations)
* [`requestDisableBatteryOptimizations()`](#requestdisablebatteryoptimizations)
* [`enableWebViewOptimizations()`](#enablewebviewoptimizations)
* [`disableWebViewOptimizations()`](#disablewebviewoptimizations)
* [`moveToBackground()`](#movetobackground)
* [`moveToForeground()`](#movetoforeground)
* [`isScreenOff()`](#isscreenoff)
* [`isEnabled()`](#isenabled)
* [`isActive()`](#isactive)
* [`wakeUp()`](#wakeup)
* [`unlock()`](#unlock)
* [`addListener('appInBackground', ...)`](#addlistenerappinbackground)
* [`addListener('appInForeground', ...)`](#addlistenerappinforeground)
* [`removeAllListeners()`](#removealllisteners)
* [Interfaces](#interfaces)
* [Type Aliases](#type-aliases)

</docgen-index>

<docgen-api>
<!--Update the source file JSDoc comments and rerun docgen to update the docs below-->

### enable()

```typescript
enable() => Promise<void>
```

--------------------


### disable()

```typescript
disable() => Promise<void>
```

--------------------


### getSettings()

```typescript
getSettings() => Promise<{ settings: ISettings; }>
```

**Returns:** <code>Promise&lt;{ settings: <a href="#isettings">ISettings</a>; }&gt;</code>

--------------------


### setSettings(...)

```typescript
setSettings(settings: Partial<ISettings>) => Promise<void>
```

| Param          | Type                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- |
| **`settings`** | <code><a href="#partial">Partial</a>&lt;<a href="#isettings">ISettings</a>&gt;</code> |

--------------------


### checkForegroundPermission()

```typescript
checkForegroundPermission() => Promise<PermissionStatus>
```

**Returns:** <code>Promise&lt;<a href="#permissionstatus">PermissionStatus</a>&gt;</code>

--------------------


### requestForegroundPermission()

```typescript
requestForegroundPermission() => Promise<PermissionStatus>
```

**Returns:** <code>Promise&lt;<a href="#permissionstatus">PermissionStatus</a>&gt;</code>

--------------------


### checkNotificationsPermission()

```typescript
checkNotificationsPermission() => Promise<PermissionStatus>
```

**Returns:** <code>Promise&lt;<a href="#permissionstatus">PermissionStatus</a>&gt;</code>

--------------------


### requestNotificationsPermission()

```typescript
requestNotificationsPermission() => Promise<PermissionStatus>
```

**Returns:** <code>Promise&lt;<a href="#permissionstatus">PermissionStatus</a>&gt;</code>

--------------------


### checkBatteryOptimizations()

```typescript
checkBatteryOptimizations() => Promise<{ disabled: boolean; }>
```

**Returns:** <code>Promise&lt;{ disabled: boolean; }&gt;</code>

--------------------


### requestDisableBatteryOptimizations()

```typescript
requestDisableBatteryOptimizations() => Promise<{ disabled: boolean; }>
```

**Returns:** <code>Promise&lt;{ disabled: boolean; }&gt;</code>

--------------------


### enableWebViewOptimizations()

```typescript
enableWebViewOptimizations() => Promise<void>
```

--------------------


### disableWebViewOptimizations()

```typescript
disableWebViewOptimizations() => Promise<void>
```

--------------------


### moveToBackground()

```typescript
moveToBackground() => Promise<void>
```

--------------------


### moveToForeground()

```typescript
moveToForeground() => Promise<void>
```

--------------------


### isScreenOff()

```typescript
isScreenOff() => Promise<{ isScreenOff: boolean; }>
```

**Returns:** <code>Promise&lt;{ isScreenOff: boolean; }&gt;</code>

--------------------


### isEnabled()

```typescript
isEnabled() => Promise<{ enabled: boolean; }>
```

**Returns:** <code>Promise&lt;{ enabled: boolean; }&gt;</code>

--------------------


### isActive()

```typescript
isActive() => Promise<{ activated: boolean; }>
```

**Returns:** <code>Promise&lt;{ activated: boolean; }&gt;</code>

--------------------


### wakeUp()

```typescript
wakeUp() => Promise<void>
```

--------------------


### unlock()

```typescript
unlock() => Promise<void>
```

--------------------


### addListener('appInBackground', ...)

```typescript
addListener(eventName: 'appInBackground', listenerFunc: () => void) => Promise<PluginListenerHandle>
```

| Param              | Type                           |
| ------------------ | ------------------------------ |
| **`eventName`**    | <code>'appInBackground'</code> |
| **`listenerFunc`** | <code>() =&gt; void</code>     |

**Returns:** <code>Promise&lt;<a href="#pluginlistenerhandle">PluginListenerHandle</a>&gt;</code>

--------------------


### addListener('appInForeground', ...)

```typescript
addListener(eventName: 'appInForeground', listenerFunc: () => void) => Promise<PluginListenerHandle>
```

| Param              | Type                           |
| ------------------ | ------------------------------ |
| **`eventName`**    | <code>'appInForeground'</code> |
| **`listenerFunc`** | <code>() =&gt; void</code>     |

**Returns:** <code>Promise&lt;<a href="#pluginlistenerhandle">PluginListenerHandle</a>&gt;</code>

--------------------


### removeAllListeners()

```typescript
removeAllListeners() => Promise<void>
```

--------------------


### Interfaces


#### ISettings

| Prop                             | Type                                           |
| -------------------------------- | ---------------------------------------------- |
| **`title`**                      | <code>string</code>                            |
| **`text`**                       | <code>string</code>                            |
| **`subText`**                    | <code>string</code>                            |
| **`bigText`**                    | <code>boolean</code>                           |
| **`resume`**                     | <code>boolean</code>                           |
| **`silent`**                     | <code>boolean</code>                           |
| **`hidden`**                     | <code>boolean</code>                           |
| **`color`**                      | <code>string</code>                            |
| **`icon`**                       | <code>string</code>                            |
| **`channelName`**                | <code>string</code>                            |
| **`channelDescription`**         | <code>string</code>                            |
| **`allowClose`**                 | <code>boolean</code>                           |
| **`closeIcon`**                  | <code>string</code>                            |
| **`closeTitle`**                 | <code>string</code>                            |
| **`showWhen`**                   | <code>boolean</code>                           |
| **`disableWebViewOptimization`** | <code>boolean</code>                           |
| **`visibility`**                 | <code>'private' \| 'public' \| 'secret'</code> |


#### PermissionStatus

| Prop           | Type                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **`onchange`** | <code>((this: <a href="#permissionstatus">PermissionStatus</a>, ev: <a href="#event">Event</a>) =&gt; any) \| null</code> |
| **`state`**    | <code><a href="#permissionstate">PermissionState</a></code>                                                               |

| Method                  | Signature                                                                                                                                                                                                                                                       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **addEventListener**    | &lt;K extends "change"&gt;(type: K, listener: (this: <a href="#permissionstatus">PermissionStatus</a>, ev: PermissionStatusEventMap[K]) =&gt; any, options?: boolean \| <a href="#addeventlisteneroptions">AddEventListenerOptions</a> \| undefined) =&gt; void | Appends an event listener for events whose type attribute value is type. The callback argument sets the callback that will be invoked when the event is dispatched. The options argument sets listener-specific options. For compatibility this can be a boolean, in which case the method behaves exactly as if the value was specified as options's capture. When set to true, options's capture prevents callback from being invoked when the event's eventPhase attribute value is BUBBLING_PHASE. When false (or not present), callback will not be invoked when event's eventPhase attribute value is CAPTURING_PHASE. Either way, callback will be invoked if event's eventPhase attribute value is AT_TARGET. When set to true, options's passive indicates that the callback will not cancel the event by invoking preventDefault(). This is used to enable performance optimizations described in § 2.8 Observing event listeners. When set to true, options's once indicates that the callback will only be invoked once after which the event listener will be removed. The event listener is appended to target's event listener list and is not appended if it has the same type, callback, and capture. |
| **addEventListener**    | (type: string, listener: <a href="#eventlisteneroreventlistenerobject">EventListenerOrEventListenerObject</a>, options?: boolean \| <a href="#addeventlisteneroptions">AddEventListenerOptions</a> \| undefined) =&gt; void                                     | Appends an event listener for events whose type attribute value is type. The callback argument sets the callback that will be invoked when the event is dispatched. The options argument sets listener-specific options. For compatibility this can be a boolean, in which case the method behaves exactly as if the value was specified as options's capture. When set to true, options's capture prevents callback from being invoked when the event's eventPhase attribute value is BUBBLING_PHASE. When false (or not present), callback will not be invoked when event's eventPhase attribute value is CAPTURING_PHASE. Either way, callback will be invoked if event's eventPhase attribute value is AT_TARGET. When set to true, options's passive indicates that the callback will not cancel the event by invoking preventDefault(). This is used to enable performance optimizations described in § 2.8 Observing event listeners. When set to true, options's once indicates that the callback will only be invoked once after which the event listener will be removed. The event listener is appended to target's event listener list and is not appended if it has the same type, callback, and capture. |
| **removeEventListener** | &lt;K extends "change"&gt;(type: K, listener: (this: <a href="#permissionstatus">PermissionStatus</a>, ev: PermissionStatusEventMap[K]) =&gt; any, options?: boolean \| <a href="#eventlisteneroptions">EventListenerOptions</a> \| undefined) =&gt; void       | Removes the event listener in target's event listener list with the same type, callback, and options.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **removeEventListener** | (type: string, listener: <a href="#eventlisteneroreventlistenerobject">EventListenerOrEventListenerObject</a>, options?: boolean \| <a href="#eventlisteneroptions">EventListenerOptions</a> \| undefined) =&gt; void                                           | Removes the event listener in target's event listener list with the same type, callback, and options.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |


#### PermissionStatusEventMap

| Prop           | Type                                    |
| -------------- | --------------------------------------- |
| **`"change"`** | <code><a href="#event">Event</a></code> |


#### Event

An event which takes place in the DOM.

| Prop                   | Type                                                        | Description                                                                                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`bubbles`**          | <code>boolean</code>                                        | Returns true or false depending on how event was initialized. True if event goes through its target's ancestors in reverse tree order, and false otherwise.                                                                                                |
| **`cancelBubble`**     | <code>boolean</code>                                        |                                                                                                                                                                                                                                                            |
| **`cancelable`**       | <code>boolean</code>                                        | Returns true or false depending on how event was initialized. Its return value does not always carry meaning, but true can indicate that part of the operation during which event was dispatched, can be canceled by invoking the preventDefault() method. |
| **`composed`**         | <code>boolean</code>                                        | Returns true or false depending on how event was initialized. True if event invokes listeners past a ShadowRoot node that is the root of its target, and false otherwise.                                                                                  |
| **`currentTarget`**    | <code><a href="#eventtarget">EventTarget</a> \| null</code> | Returns the object whose event listener's callback is currently being invoked.                                                                                                                                                                             |
| **`defaultPrevented`** | <code>boolean</code>                                        | Returns true if preventDefault() was invoked successfully to indicate cancelation, and false otherwise.                                                                                                                                                    |
| **`eventPhase`**       | <code>number</code>                                         | Returns the event's phase, which is one of NONE, CAPTURING_PHASE, AT_TARGET, and BUBBLING_PHASE.                                                                                                                                                           |
| **`isTrusted`**        | <code>boolean</code>                                        | Returns true if event was dispatched by the user agent, and false otherwise.                                                                                                                                                                               |
| **`returnValue`**      | <code>boolean</code>                                        |                                                                                                                                                                                                                                                            |
| **`srcElement`**       | <code><a href="#eventtarget">EventTarget</a> \| null</code> |                                                                                                                                                                                                                                                            |
| **`target`**           | <code><a href="#eventtarget">EventTarget</a> \| null</code> | Returns the object to which event is dispatched (its target).                                                                                                                                                                                              |
| **`timeStamp`**        | <code>number</code>                                         | Returns the event's timestamp as the number of milliseconds measured relative to the time origin.                                                                                                                                                          |
| **`type`**             | <code>string</code>                                         | Returns the type of event, e.g. "click", "hashchange", or "submit".                                                                                                                                                                                        |
| **`AT_TARGET`**        | <code>number</code>                                         |                                                                                                                                                                                                                                                            |
| **`BUBBLING_PHASE`**   | <code>number</code>                                         |                                                                                                                                                                                                                                                            |
| **`CAPTURING_PHASE`**  | <code>number</code>                                         |                                                                                                                                                                                                                                                            |
| **`NONE`**             | <code>number</code>                                         |                                                                                                                                                                                                                                                            |

| Method                       | Signature                                                                                    | Description                                                                                                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **composedPath**             | () =&gt; EventTarget[]                                                                       | Returns the invocation target objects of event's path (objects on which listeners will be invoked), except for any nodes in shadow trees of which the shadow root's mode is "closed" that are not reachable from event's currentTarget. |
| **initEvent**                | (type: string, bubbles?: boolean \| undefined, cancelable?: boolean \| undefined) =&gt; void |                                                                                                                                                                                                                                         |
| **preventDefault**           | () =&gt; void                                                                                | If invoked when the cancelable attribute value is true, and while executing a listener for the event with passive set to false, signals to the operation that caused event to be dispatched that it needs to be canceled.               |
| **stopImmediatePropagation** | () =&gt; void                                                                                | Invoking this method prevents event from reaching any registered event listeners after the current one finishes running and, when dispatched in a tree, also prevents event from reaching any other objects.                            |
| **stopPropagation**          | () =&gt; void                                                                                | When dispatched in a tree, invoking this method prevents event from reaching any objects other than the current object.                                                                                                                 |


#### EventTarget

<a href="#eventtarget">EventTarget</a> is a DOM interface implemented by objects that can receive events and may have listeners for them.

| Method                  | Signature                                                                                                                                                                                                                           | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **addEventListener**    | (type: string, listener: <a href="#eventlisteneroreventlistenerobject">EventListenerOrEventListenerObject</a> \| null, options?: boolean \| <a href="#addeventlisteneroptions">AddEventListenerOptions</a> \| undefined) =&gt; void | Appends an event listener for events whose type attribute value is type. The callback argument sets the callback that will be invoked when the event is dispatched. The options argument sets listener-specific options. For compatibility this can be a boolean, in which case the method behaves exactly as if the value was specified as options's capture. When set to true, options's capture prevents callback from being invoked when the event's eventPhase attribute value is BUBBLING_PHASE. When false (or not present), callback will not be invoked when event's eventPhase attribute value is CAPTURING_PHASE. Either way, callback will be invoked if event's eventPhase attribute value is AT_TARGET. When set to true, options's passive indicates that the callback will not cancel the event by invoking preventDefault(). This is used to enable performance optimizations described in § 2.8 Observing event listeners. When set to true, options's once indicates that the callback will only be invoked once after which the event listener will be removed. The event listener is appended to target's event listener list and is not appended if it has the same type, callback, and capture. |
| **dispatchEvent**       | (event: <a href="#event">Event</a>) =&gt; boolean                                                                                                                                                                                   | Dispatches a synthetic event event to target and returns true if either event's cancelable attribute value is false or its preventDefault() method was not invoked, and false otherwise.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **removeEventListener** | (type: string, callback: <a href="#eventlisteneroreventlistenerobject">EventListenerOrEventListenerObject</a> \| null, options?: boolean \| <a href="#eventlisteneroptions">EventListenerOptions</a> \| undefined) =&gt; void       | Removes the event listener in target's event listener list with the same type, callback, and options.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |


#### EventListener


#### EventListenerObject

| Method          | Signature                                    |
| --------------- | -------------------------------------------- |
| **handleEvent** | (evt: <a href="#event">Event</a>) =&gt; void |


#### AddEventListenerOptions

| Prop          | Type                 |
| ------------- | -------------------- |
| **`once`**    | <code>boolean</code> |
| **`passive`** | <code>boolean</code> |


#### EventListenerOptions

| Prop          | Type                 |
| ------------- | -------------------- |
| **`capture`** | <code>boolean</code> |


#### PluginListenerHandle

| Prop         | Type                                      |
| ------------ | ----------------------------------------- |
| **`remove`** | <code>() =&gt; Promise&lt;void&gt;</code> |


### Type Aliases


#### Partial

Make all properties in T optional

<code>{ [P in keyof T]?: T[P]; }</code>


#### EventListenerOrEventListenerObject

<code><a href="#eventlistener">EventListener</a> | <a href="#eventlistenerobject">EventListenerObject</a></code>


#### PermissionState

<code>"denied" | "granted" | "prompt"</code>

</docgen-api>
