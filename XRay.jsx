import { createSignal, For, Show, mergeProps } from "solid-js"
import './xray.css'

class XRayCircularChecker {

	constructor() {
		this.seen = new WeakMap()
	}

	check(obj, path) {

		const paths = this.seen.get(obj)

		if(!paths){
			// first time seen, just add
			this.seen.set(obj, [path])
			return false
		}

		for(const seen of paths){

			if(seen === path)
				// same as before, this is rerender
				return false

			if(path.startsWith(seen) && path.startsWith(seen+'.'))
				// path is descendant, this is circular
				return true
		}

		// not same, not parent, different location
		paths.push(path)

		return false
	}
}

class XRayEngine {

	constructor(obj, params={}) {

		this.collapsed = {}
		this.collapseReversed = false
		this.circular = new XRayCircularChecker()

		// collapse
		if(params.collapse){
			if(params.collapse === true){
				// collapse everything, click reveals node
				this.collapseReversed = true
			} else if(params.collapse === 'top'){
				// collapse all top level
				for(const key in obj)
					this.collapsed['.'+key] = true
			} else if(Array.isArray(params.collapse)){
				// collapse only specified
				for(const key of params.collapse)
					this.collapsed['.'+key] = true
			} else {
				console.error('XRay invalid prop :collapse: must be array, "top" or true')
			}
		}

		// collapse except
		if(params.collapseExcept){
			for(const key in obj)
				if(!params.collapseExcept.includes(key))
					this.collapsed['.'+key] = true
		}
	}

	functionSniffer(obj){
		/** Detect attached properties to function object **/

		const names = Object.getOwnPropertyNames(obj)

		// filter out native props
		for(const name of this._functionNativeProps){
			const idx = names.indexOf(name)
			if(idx > -1)
				names.splice(idx, 1)
		}

		return names
	}
	_functionNativeProps = ['length', 'name', 'arguments', 'caller', 'prototype']

	instanceSniffer(obj){
		/** Return all methods and properties of the object, except the base one **/

		// get props, these are all available in topmost object
		const properties = Object.getOwnPropertyNames(obj)

		// collect class methods recursively
		const methodSet = []
		let parent = Object.getPrototypeOf(obj)

		while(true) {

			// bail out if base class is reached
			if(parent.constructor.name == 'Object')
				break;

			// gather methods of current object
			methodSet.push(Object.getOwnPropertyNames(parent))

			// get parent class
			parent = Object.getPrototypeOf(parent.constructor.prototype)
		}

		// flatten, reverse (so methods are listed in class extension order), and remove dupes
		const methods = [...new Set([].concat(...(methodSet.reverse())))]

		// merge with props and serve hot
		return properties.concat(methods)
	}

	isCollapsed(path){
		/** Answer if elem should be collapsed, according to config and state **/

		return this.collapseReversed
			? !this.collapsed[path]
			: this.collapsed[path]
	}

	toggleCollapse(path){
		/** Toggle element visibility **/

		if(this.collapsed[path])
			delete this.collapsed[path]
		else
			this.collapsed[path] = true

		return this.isCollapsed(path)
	}
}


const XRay = props => {

	const merged = mergeProps({
		obj: undefined,
		header: true,
		title: "XRay",
		minimize: false,
		collapse: false,
		collapseExcept: false,
	}, props)

	const app = new XRayEngine(merged.obj, {
		collapse: merged.collapse,
		collapseExcept: merged.collapseExcept,
	})

	const [isMinimized, setMinimize] = createSignal(merged.minimize)

	const togglePanel = () => setMinimize(!isMinimized())

	function promptPath(e){
		const title = e.target.title
		if(title){
			e.stopPropagation()
			e.preventDefault()
			prompt('Object path:', title)
		}
	}

	return <div class="XRay" onContextMenu={promptPath}>

		<Show when={merged.header}>
			<div class="xrHeader" classList={{xrMinimized:isMinimized()}} onClick={togglePanel}>
				<div class="xrTitle">{merged.title}</div>
			</div>
		</Show>

		<Show when={!isMinimized()}>
			<div class="xrContent">
				<Value app={app} obj={props.obj} path="$" />
			</div>
		</Show>
	</div>
}

export default XRay


const Value = props => {
	/** Detect object type and return appropriate renderer **/

	const app = props.app
	const obj = props.obj
	const path = props.path

	// check for circular
	if((typeof obj == 'object' || typeof obj == 'function') && obj != null){
		if(app.circular.check(obj, path))
			return <Special type="CircularReference" obj="" />
	}

	switch(typeof obj){
		case 'object':
			const objType = Object.prototype.toString.call(obj)
			switch(objType){
				case '[object Object]':
					// plain object or instance of a function/class
					if(obj.constructor.name == 'Object')
						return <Obj app={app} obj={obj} path={path} />
					else
						return <Instance app={app} obj={obj} path={path} />
				case '[object Array]':
					return <Arr app={app} obj={obj} path={path} />
				case '[object Null]':
					return <span class="xrNull">null</span>
				case '[object Date]':
					return <Special type="Date" obj={obj.toString()} />
				case '[object RegExp]':
					return <Special type="RegExp" obj={obj.toString()} />
				case '[object Error]':
					return <Special type="Error" obj={obj.toString()} />
				case '[object Promise]':
					return <Special type="Promise" obj="" />
				case '[object Map]':
					return <MapX app={app} obj={obj} path={path} />
				case '[object Set]':
					return <SetX app={app} obj={obj} path={path} />
				case '[object WeakMap]':
					return <Special type="WeakMap" obj="" />
				case '[object WeakSet]':
					return <Special type="WeakSet" obj="" />
				case '[object Storage]':
					return <Instance app={app} obj={obj} path={path} />
				case '[object Int8Array]':
				case '[object Uint8Array]':
				case '[object Uint8ClampedArray]':
				case '[object Int16Array]':
				case '[object Uint16Array]':
				case '[object Int32Array]':
				case '[object Uint32Array]':
				case '[object Float32Array]':
				case '[object Float64Array]':
				case '[object BigInt64Array]':
				case '[object BigUint64Array]':
				case '[object ArrayBuffer]':
					const arrType = (/\[object (\w+)\]/.exec(objType))[1]
					return <Dumper class="xrSuperArray" label={arrType} obj={obj} />
				case '[object Math]':
					return <Func app={app} obj={obj} path={path} />
				case '[object MouseEvent]': 	// firefox
				case '[object PointerEvent]': 	// blink
					return <Instance app={app} obj={obj} path={path} />
				default:
					return <Unknown obj={obj} />
			}
		case 'string':
			if(obj === "")
				return <span class="xrString xrEmpty"></span>
			else
				return <span class="xrString">{obj}</span>
		case 'number':
			return <span class="xrNumeric">{obj}</span>
		case 'boolean':
			return <span class="xrBool">{obj.toString()}</span>
		case 'undefined':
			return <span class="xrNull">undefined</span>
		case 'function':
			return <Func app={app} obj={obj} path={path} />
		case 'bigint':
			return <GenericLabel class="xrNumeric" label="BigInt" obj={obj} />
		case 'symbol':
			return <Special type="Symbol" obj={obj.description} />
		default:
			return <Unknown obj={obj} />
	}
}

const Arr = props => {

	if(!props.obj.length)
		return <span class="xrArray xrEmpty"></span>
	else
		return <table>
			<For each={props.obj}>{(elem, i) =>
				<ArrRow app={props.app} obj={elem} path={`${props.path}[${i}]`} i={i} />}
			</For>
		</table>
}

const ArrRow = props => {

	const [isCollapsed, setCollapse] = createSignal(!!props.app.isCollapsed(props.path))

	const toggleCollapse = () => setCollapse(props.app.toggleCollapse(props.path))

	return <tr classList={{ xrCollapsed: isCollapsed() }}>
			<td class="xrKey xrArray" title={props.path} onClick={toggleCollapse}>{props.i}</td>
			<td class="xrValue">
				<Show when={!isCollapsed()}>
					<Value app={props.app} obj={props.obj} path={props.path} />
				</Show>
			</td>
		</tr>
}

const Obj = props => {

	const keys = Object.keys(props.obj)

	if(!keys.length)
		return <span class="xrObject xrEmpty"></span>
	else
		return <table>
			<For each={keys}>{ key =>
				<ObjRow app={props.app} key={key} obj={props.obj[key]} path={props.path+'.'+key}/>}
			</For>
		</table>
}

const ObjRow = props => {

	const [isCollapsed, setCollapse] = createSignal(!!props.app.isCollapsed(props.path))

	const toggleCollapse = () => setCollapse(props.app.toggleCollapse(props.path))

	return <tr classList={{ xrCollapsed: isCollapsed() }}>
				<td class="xrKey" title={props.path} onClick={toggleCollapse}>{props.key}</td>
				<td class="xrValue">
					<Show when={!isCollapsed()}>
						<Value app={props.app} obj={props.obj} path={props.path} />
					</Show>
				</td>
			</tr>
}

const Instance = props => {

	const keys = props.app.instanceSniffer(props.obj)
	const title = (props.obj.constructor.name || 'anonymous') + ' instance'

	return <>
		<span class="xrLabel xrInstance">{title}</span>

		<Show when={keys.length}>
			<table>
				<For each={keys}>{ key =>
					<ObjRow app={props.app} key={key} obj={props.obj[key]} path={props.path+'.'+key} />}
				</For>
			</table>
		</Show>
	</>
}

const MapX = props => {

	return <>
		<span class="xrLabel">Map</span>

		<Show when={props.obj.size} fallback={<span class="xrObject xrEmpty"></span>}>

			<table>
				<For each={[...props.obj]}>{ elem =>
					<ObjRow app={props.app} key={elem[0].toString()} obj={elem[1]} path={props.path+'.'+elem[0].toString()} /> }
				</For>
			</table>

		</Show>
	</>
}

const SetX = props => {

	return <>
		<span class="xrLabel">Set</span>

		<Show when={props.obj.size} fallback={<span class="xrArray xrEmpty"></span>}>

			<table>
				<For each={[...props.obj]}>{ elem =>
					<tr><td><Value app={props.app} obj={elem} path={props.path}/></td></tr> }
				</For>
			</table>

		</Show>
	</>
}

const Func = props => {

	const keys = props.app.functionSniffer(props.obj)
	const objType = Object.prototype.toString.call(props.obj)
	const fnType = (/\[object (\w+)\]/.exec(objType))[1]
	const fnName = props.obj.name || '[Anonymous]'

	if(!keys.length)
		return <span class="xrFunction">{fnType} {fnName}</span>
	else
		return <>

			<span class="xrFunction">{fnType} {fnName}</span>

			<table>
				<For each={keys}>{ key =>
					<ObjRow app={props.app} key={key} obj={props.obj[key]} path={props.path+'.'+key} />}
				</For>
			</table>
		</>
}

const GenericLabel = props => {
	return <span class={props.class}>
				<span class="xrLabel">{props.label}</span>
				{props.obj}
			</span>
}

const Special = props => {
	return <div class={"xr" + props.type}>
				<span class="xrLabel">{props.type}</span>
				{props.obj}
			</div>
}

const Dumper = props => {
	// only used for ArrayBuffer
	return <span class={"xrLabel "+props.class} onClick={()=>console.log(props.obj)}>{props.label}</span>
}

const Unknown = props => {

	let text;
	try {
		text = props.obj.toString()
	} catch {
		text = 'unknown'
	}
	return <span class="xrUnknown" onClick={()=>console.log(props.obj)}><span class="xrLabel">?</span>{text}</span>
}