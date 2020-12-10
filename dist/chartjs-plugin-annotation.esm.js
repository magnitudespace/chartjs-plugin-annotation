/*!
* chartjs-plugin-annotation v3.0.0-beta
* undefined
 * (c) 2020 chartjs-plugin-annotation Contributors
 * Released under the MIT License
 */
import { Element, defaults, Animations } from 'chart.js';
import { distanceBetweenPoints, callback, fontString, toRadians, isArray, isObject, merge, valueOrDefault, isFinite as isFinite$1, clipArea, unclipArea } from 'chart.js/helpers';

const clickHooks = ['click', 'dblclick'];
const moveHooks = ['enter', 'leave'];
const hooks = clickHooks.concat(moveHooks);

function updateListeners(chart, state, options) {
	const annotations = options.annotations || [];
	state.listened = false;

	hooks.forEach(hook => {
		if (typeof options[hook] === 'function') {
			state.listened = true;
			state.listeners[hook] = options[hook];
		}
	});
	moveHooks.forEach(hook => {
		if (typeof options[hook] === 'function') {
			state.moveListened = true;
		}
	});

	if (!state.listened || !state.moveListened) {
		annotations.forEach(scope => {
			if (!state.listened) {
				clickHooks.forEach(hook => {
					if (typeof scope[hook] === 'function') {
						state.listened = true;
					}
				});
			}
			if (!state.moveListened) {
				moveHooks.forEach(hook => {
					if (typeof scope[hook] === 'function') {
						state.listened = true;
						state.moveListened = true;
					}
				});
			}
		});
	}
}

function handleEvent(chart, state, event, options) {
	if (state.listened) {
		switch (event.type) {
		case 'mousemove':
		case 'mouseout':
			handleMoveEvents(chart, state, event);
			break;
		case 'click':
			handleClickEvents(chart, state, event, options);
			break;
		}
	}
}

function handleMoveEvents(chart, state, event) {
	if (!state.moveListened) {
		return;
	}

	let element;

	if (event.type === 'mousemove') {
		element = getNearestItem(state.elements, event);
	}

	const previous = state.hovered;
	state.hovered = element;

	dispatchMoveEvents(chart, state, previous, element);
}

function dispatchMoveEvents(chart, state, previous, element) {
	if (previous && previous !== element) {
		dispatchEvent(chart, state, previous.options.leave || state.listeners.leave, previous);
	}
	if (element && element !== previous) {
		dispatchEvent(chart, state, element.options.enter || state.listeners.enter, element);
	}
}

function handleClickEvents(chart, state, event, options) {
	const listeners = state.listeners;
	const element = getNearestItem(state.elements, event);
	if (element) {
		const elOpts = element.options;
		const dblclick = elOpts.dblclick || listeners.dblclick;
		const click = elOpts.click || listeners.click;
		if (element.clickTimeout) {
			// 2nd click before timeout, so its a double click
			clearTimeout(element.clickTimeout);
			delete element.clickTimeout;
			dispatchEvent(chart, state, dblclick, element);
		} else if (dblclick) {
			// if there is a dblclick handler, wait for dblClickSpeed ms before deciding its a click
			element.clickTimeout = setTimeout(() => {
				delete element.clickTimeout;
				dispatchEvent(chart, state, click, element);
			}, options.dblClickSpeed);
		} else {
			// no double click handler, just call the click handler directly
			dispatchEvent(chart, state, click, element);
		}
	}
}

function dispatchEvent(chart, _state, handler, element) {
	callback(handler, [{chart, element}]);
}

function getNearestItem(elements, position) {
	let minDistance = Number.POSITIVE_INFINITY;

	return elements
		.filter((element) => element.inRange(position.x, position.y))
		.reduce((nearestItems, element) => {
			const center = element.getCenterPoint();
			const distance = distanceBetweenPoints(position, center);

			if (distance < minDistance) {
				nearestItems = [element];
				minDistance = distance;
			} else if (distance === minDistance) {
				// Can have multiple items at the same distance in which case we sort by size
				nearestItems.push(element);
			}

			return nearestItems;
		}, [])
		.sort((a, b) => {
			// If there are multiple elements equally close,
			// sort them by size, then by index
			const sizeA = a.getArea();
			const sizeB = b.getArea();
			return (sizeA > sizeB || sizeA < sizeB) ? sizeA - sizeB : a._index - b._index;
		})
		.slice(0, 1)[0]; // return only the top item
}

class BoxAnnotation extends Element {
	inRange(mouseX, mouseY, useFinalPosition) {
		const {x, y, width, height} = this.getProps(['x', 'y', 'width', 'height'], useFinalPosition);

		return mouseX >= x &&
			mouseX <= x + width &&
			mouseY >= y &&
			mouseY <= y + height;
	}

	getCenterPoint(useFinalPosition) {
		const {x, y, width, height} = this.getProps(['x', 'y', 'width', 'height'], useFinalPosition);
		return {
			x: x + width / 2,
			y: y + height / 2
		};
	}

	draw(ctx) {
		const {x, y, width, height, options} = this;

		ctx.save();

		ctx.lineWidth = options.borderWidth;
		ctx.strokeStyle = options.borderColor;
		ctx.fillStyle = options.backgroundColor;

		ctx.fillRect(x, y, width, height);
		ctx.strokeRect(x, y, width, height);

		ctx.restore();
	}
}

BoxAnnotation.id = 'boxAnnotation';

BoxAnnotation.defaults = {
	display: true,
	borderWidth: 1
};

BoxAnnotation.defaultRoutes = {
	borderColor: 'color',
	backgroundColor: 'color'
};

const PI = Math.PI;
const HALF_PI = PI / 2;

const pointInLine = (p1, p2, t) => ({x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y)});
const interpolateX = (y, p1, p2) => pointInLine(p1, p2, Math.abs((y - p1.y) / (p2.y - p1.y))).x;
const interpolateY = (x, p1, p2) => pointInLine(p1, p2, Math.abs((x - p1.x) / (p2.x - p1.x))).y;

class LineAnnotation extends Element {
	intersects(x, y, epsilon) {
		epsilon = epsilon || 0.001;
		const me = this;
		const p1 = {x: me.x, y: me.y};
		const p2 = {x: me.x2, y: me.y2};
		const dy = interpolateY(x, p1, p2);
		const dx = interpolateX(y, p1, p2);
		return (
			(!isFinite(dy) || Math.abs(y - dy) < epsilon) &&
			(!isFinite(dx) || Math.abs(x - dx) < epsilon)
		);
	}

	labelIsVisible() {
		const label = this.options.label;
		return label && label.enabled && label.content;
	}

	isOnLabel(x, y) {
		const labelRect = this.labelRect || {};
		const w2 = labelRect.width / 2;
		const h2 = labelRect.height / 2;
		return this.labelIsVisible() &&
			x >= labelRect.x - w2 &&
			x <= labelRect.x + w2 &&
			y >= labelRect.y - h2 &&
			y <= labelRect.y + h2;
	}

	inRange(x, y) {
		const epsilon = this.options.borderWidth || 1;
		return this.intersects(x, y, epsilon) || this.isOnLabel(x, y);
	}

	getCenterPoint() {
		return {
			x: (this.x2 + this.x) / 2,
			y: (this.y2 + this.y) / 2
		};
	}

	draw(ctx) {
		const {x, y, x2, y2, options} = this;
		ctx.save();

		ctx.lineWidth = options.borderWidth;
		ctx.strokeStyle = options.borderColor;

		if (ctx.setLineDash) {
			ctx.setLineDash(options.borderDash);
		}
		ctx.lineDashOffset = options.borderDashOffset;

		// Draw
		ctx.beginPath();
		ctx.moveTo(x, y);
		ctx.lineTo(x2, y2);
		ctx.stroke();

		if (this.labelIsVisible()) {
			drawLabel(ctx, this);
		}

		ctx.restore();
	}
}

LineAnnotation.id = 'lineAnnotation';
LineAnnotation.defaults = {
	display: true,
	borderDash: [],
	borderDashOffset: 0,
	label: {
		backgroundColor: 'rgba(0,0,0,0.8)',
		font: {
			family: defaults.font.family,
			size: defaults.font.size,
			style: 'bold',
			color: '#fff',
		},
		xPadding: 6,
		yPadding: 6,
		rotation: 0,
		cornerRadius: 6,
		position: 'center',
		xAdjust: 0,
		yAdjust: 0,
		enabled: false,
		content: null
	}
};

function calculateAutoRotation(line) {
	const {x, y, x2, y2} = line;
	let cathetusAdjacent, cathetusOpposite;
	if (line.options.mode === 'horizontal') {
		cathetusAdjacent = y2 > y ? x2 - x : -(x2 - x);
		cathetusOpposite = Math.abs(y - y2);
	} else {
		cathetusAdjacent = Math.abs(x - x2);
		cathetusOpposite = x2 > x ? y2 - y : -(y2 - y);
	}
	return Math.atan(cathetusOpposite / cathetusAdjacent);
}

function drawLabel(ctx, line) {
	const label = line.options.label;

	ctx.font = fontString(
		label.font.size,
		label.font.style,
		label.font.family
	);
	ctx.textAlign = 'center';

	const {width, height} = measureLabel(ctx, label);
	const pos = calculateLabelPosition(line, width, height);
	const rotation = label.rotation === 'auto' ? calculateAutoRotation(line) : toRadians(label.rotation);

	line.labelRect = {x: pos.x, y: pos.y, width, height};

	ctx.translate(pos.x, pos.y);
	ctx.rotate(rotation);

	ctx.fillStyle = label.backgroundColor;
	roundedRect(ctx, -(width / 2), -(height / 2), width, height, label.cornerRadius);
	ctx.fill();

	ctx.fillStyle = label.font.color;
	if (isArray(label.content)) {
		let textYPosition = -(height / 2) + label.yPadding;
		for (let i = 0; i < label.content.length; i++) {
			ctx.textBaseline = 'top';
			ctx.fillText(
				label.content[i],
				-(width / 2) + (width / 2),
				textYPosition
			);

			textYPosition += label.font.size + label.yPadding;
		}
	} else {
		ctx.textBaseline = 'middle';
		ctx.fillText(label.content, 0, 0);
	}
}

const widthCache = new Map();
function measureLabel(ctx, label) {
	const content = label.content;
	const lines = isArray(content) ? content : [content];
	const count = lines.length;
	let width = 0;
	for (let i = 0; i < count; i++) {
		const text = lines[i];
		if (!widthCache.has(text)) {
			widthCache.set(text, ctx.measureText(text).width);
		}
		width = Math.max(width, widthCache.get(text));
	}
	width += 2 * label.xPadding;

	return {
		width,
		height: count * label.font.size + ((count + 1) * label.yPadding)
	};
}

function calculateLabelPosition(line, width, height) {
	const label = line.options.label;
	const {xPadding, xAdjust, yPadding, yAdjust} = label;
	const p1 = {x: line.x, y: line.y};
	const p2 = {x: line.x2, y: line.y2};
	let x, y, pt;

	switch (label.position) {
	case 'top':
		y = yPadding + yAdjust;
		x = interpolateX(y, p1, p2);
		break;
	case 'bottom':
		y = height - yPadding + yAdjust;
		x = interpolateX(y, p1, p2);
		break;
	case 'left':
		x = xPadding + xAdjust;
		y = interpolateY(x, p1, p2);
		break;
	case 'right':
		x = width - xPadding + xAdjust;
		y = interpolateY(x, p1, p2);
		break;
	default:
		pt = pointInLine(p1, p2, 0.5);
		x = pt.x + xAdjust;
		y = pt.y + yAdjust;
	}
	return {x, y};
}


/**
 * Creates a "path" for a rectangle with rounded corners at position (x, y) with a
 * given size (width, height) and the same `radius` for all corners.
 * @param {CanvasRenderingContext2D} ctx - The canvas 2D Context.
 * @param {number} x - The x axis of the coordinate for the rectangle starting point.
 * @param {number} y - The y axis of the coordinate for the rectangle starting point.
 * @param {number} width - The rectangle's width.
 * @param {number} height - The rectangle's height.
 * @param {number} radius - The rounded amount (in pixels) for the four corners.
 * @todo handle `radius` as top-left, top-right, bottom-right, bottom-left array/object?
 */
function roundedRect(ctx, x, y, width, height, radius) {
	if (radius) {
		const r = Math.min(radius, height / 2, width / 2);
		const left = x + r;
		const top = y + r;
		const right = x + width - r;
		const bottom = y + height - r;

		ctx.moveTo(x, top);
		if (left < right && top < bottom) {
			ctx.arc(left, top, r, -PI, -HALF_PI);
			ctx.arc(right, top, r, -HALF_PI, 0);
			ctx.arc(right, bottom, r, 0, HALF_PI);
			ctx.arc(left, bottom, r, HALF_PI, PI);
		} else if (left < right) {
			ctx.moveTo(left, y);
			ctx.arc(right, top, r, -HALF_PI, HALF_PI);
			ctx.arc(left, top, r, HALF_PI, PI + HALF_PI);
		} else if (top < bottom) {
			ctx.arc(left, top, r, -PI, 0);
			ctx.arc(left, bottom, r, 0, PI);
		} else {
			ctx.arc(left, top, r, -PI, PI);
		}
		ctx.closePath();
		ctx.moveTo(x, y);
	} else {
		ctx.rect(x, y, width, height);
	}
}

const chartStates = new Map();

const annotationTypes = {
	box: BoxAnnotation,
	line: LineAnnotation
};

var annotation = {
	id: 'annotation',

	beforeInit(chart) {
		chartStates.set(chart, {
			elements: [],
			listeners: {},
			listened: false,
			moveListened: false,
			scales: new Set()
		});
	},

	beforeUpdate(chart, args, options) {
		if (isObject(options.annotations)) {
			const array = new Array();
			Object.keys(options.annotations).forEach(key => {
				const value = options.annotations[key];
				if (isObject(value)) {
					value.id = key;
					array.push(value);
				}
			});
			options.annotations = array;
		}

		if (!args.mode) {
			bindAfterDataLimits(chart, options);
		}
	},

	afterUpdate(chart, args, options) {
		const state = chartStates.get(chart);
		updateListeners(chart, state, options);
		updateElements(chart, state, options, args.mode);
	},

	beforeDatasetsDraw(chart, options) {
		draw(chart, options, 'beforeDatasetsDraw');
	},

	afterDatasetsDraw(chart, options) {
		draw(chart, options, 'afterDatasetsDraw');
	},

	afterDraw(chart, options) {
		draw(chart, options, 'afterDraw');
	},

	beforeEvent(chart, event, _replay, options) {
		const state = chartStates.get(chart);
		handleEvent(chart, state, event, options);
	},

	destroy(chart) {
		chartStates.delete(chart);
	},

	defaults: {
		drawTime: 'afterDatasetsDraw',
		dblClickSpeed: 350, // ms
		annotations: {},
		animation: {
			numbers: {
				properties: ['x', 'y', 'x2', 'y2', 'width', 'height'],
				type: 'number'
			},
		}
	},
};

const directUpdater = {
	update: Object.assign
};

function resolveAnimations(chart, animOpts, mode) {
	if (mode === 'reset' || mode === 'none' || mode === 'resize') {
		return directUpdater;
	}
	return new Animations(chart, animOpts);
}

function updateElements(chart, state, options, mode) {
	const chartAnims = chart.options.animation;
	const animOpts = chartAnims && merge({}, [chartAnims, options.animation]);
	const animations = resolveAnimations(chart, animOpts, mode);

	const elements = state.elements;
	const annotations = options.annotations || [];
	const count = annotations.length;
	const start = elements.length;

	if (start < count) {
		const add = count - start;
		elements.splice(start, 0, ...new Array(add));
	} else if (start > count) {
		elements.splice(count, start - count);
	}
	for (let i = 0; i < annotations.length; i++) {
		const annotation = annotations[i];
		let el = elements[i];
		const elType = annotationTypes[annotation.type] || annotationTypes.line;
		if (!el || !(el instanceof elType)) {
			el = elements[i] = new elType();
		}
		const properties = calculateElementProperties(chart, annotation, elType.defaults);
		animations.update(el, properties);

		const display = typeof annotation.display === 'function' ? callback(annotation.display, [{chart, element:el}], this) : valueOrDefault(annotation.display, true);
		el._display = !!display;
	}
}

function scaleValue(scale, value, fallback) {
	value = scale.parse(value);
	return isFinite$1(value) ? scale.getPixelForValue(value) : fallback;
}

function calculateElementProperties(chart, options, defaults) {
	const scale = chart.scales[options.scaleID];

	let {top: y, left: x, bottom: y2, right: x2} = chart.chartArea;
	let min, max;

	if (scale) {
		min = scaleValue(scale, options.value, NaN);
		max = scaleValue(scale, options.endValue, min);
		if (scale.isHorizontal()) {
			x = min;
			x2 = max;
		} else {
			y = min;
			y2 = max;
		}
	} else {
		const xScale = chart.scales[options.xScaleID];
		const yScale = chart.scales[options.yScaleID];
		if (!xScale && !yScale) {
			return {options: {}};
		}

		if (xScale) {
			min = scaleValue(xScale, options.xMin, x);
			max = scaleValue(xScale, options.xMax, x2);
			x = Math.min(min, max);
			x2 = Math.max(min, max);
		}

		if (yScale) {
			min = scaleValue(yScale, options.yMin, y2);
			max = scaleValue(yScale, options.yMax, y);
			y = Math.min(min, max);
			y2 = Math.max(min, max);
		}
	}

	return {
		x,
		y,
		x2,
		y2,
		width: x2 - x,
		height: y2 - y,
		options: merge(Object.create(null), [defaults, options])
	};
}

function draw(chart, options, caller) {
	const {ctx, chartArea} = chart;
	const elements = chartStates.get(chart).elements;

	clipArea(ctx, chartArea);
	for (let i = 0; i < elements.length; i++) {
		const el = elements[i];
		if (el._display && (el.options.drawTime || options.drawTime || caller) === caller) {
			el.draw(ctx);
		}
	}
	unclipArea(ctx);
}

function bindAfterDataLimits(chart, options) {
	const state = chartStates.get(chart);
	const scaleSet = state.scales;
	const scales = chart.scales || {};
	Object.keys(scales).forEach(id => {
		const scale = chart.scales[id];
		if (scaleSet.has(scale)) {
			return;
		}
		const originalHook = scale.afterDataLimits;
		scale.afterDataLimits = function(...args) {
			if (originalHook) {
				originalHook.apply(scale, [...args]);
			}
			adjustScaleRange(scale, state, options);
		};
		scaleSet.add(scale);
	});
}

function getAnnotationOptions(elements, options) {
	if (elements && elements.length) {
		return elements.map(el => el.options);
	}
	return options.annotations || [];
}

function adjustScaleRange(scale, state, options) {
	const annotations = getAnnotationOptions(state.elements, options);
	const range = getScaleLimits(scale, annotations);
	let changed = false;
	if (isFinite$1(range.min) &&
		typeof scale.options.min === 'undefined' &&
		typeof scale.options.suggestedMin === 'undefined') {
		scale.min = range.min;
		changed = true;
	}
	if (isFinite$1(range.max) &&
		typeof scale.options.max === 'undefined' &&
		typeof scale.options.suggestedMax === 'undefined') {
		scale.max = range.max;
		changed = true;
	}
	if (changed && typeof scale.handleTickRangeOptions === 'function') {
		scale.handleTickRangeOptions();
	}
}

function getScaleLimits(scale, annotations) {
	const axis = scale.axis;
	const scaleID = scale.id;
	const scaleIDOption = scale.axis + 'ScaleID';
	const scaleAnnotations = annotations.filter(annotation => annotation[scaleIDOption] === scaleID || annotation.scaleID === scaleID);
	let min = valueOrDefault(scale.min, Number.NEGATIVE_INFINITY);
	let max = valueOrDefault(scale.max, Number.POSITIVE_INFINITY);
	scaleAnnotations.forEach(annotation => {
		['value', 'endValue', axis + 'Min', axis + 'Max'].forEach(prop => {
			if (prop in annotation) {
				const value = annotation[prop];
				min = Math.min(min, value);
				max = Math.max(max, value);
			}
		});
	});
	return {min, max};
}

export { annotation as Annotation, BoxAnnotation, LineAnnotation };
