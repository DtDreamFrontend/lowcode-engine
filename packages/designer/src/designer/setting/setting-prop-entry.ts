import { obx, computed, makeObservable, runInAction, IEventBus, createModuleEventBus } from '@alilc/lowcode-editor-core';
import { GlobalEvent, IPublicModelEditor, IPublicTypeSetValueOptions } from '@alilc/lowcode-types';
import { uniqueId, isJSExpression, isSettingField } from '@alilc/lowcode-utils';
import { Setters } from '@alilc/lowcode-shell';
import { ISettingEntry } from './setting-entry';
import { INode } from '../../document';
import { IComponentMeta } from '../../component-meta';
import { Designer } from '../designer';
import { ISettingField } from './setting-field';

export class SettingPropEntry implements ISettingEntry {
  // === static properties ===
  readonly editor: IPublicModelEditor;

  readonly isSameComponent: boolean;

  readonly isMultiple: boolean;

  readonly isSingle: boolean;

  readonly setters: Setters;

  readonly nodes: INode[];

  readonly componentMeta: IComponentMeta | null;

  readonly designer: Designer;

  readonly top: ISettingEntry;

  readonly isGroup: boolean;

  readonly type: 'field' | 'group';

  readonly id = uniqueId('entry');

  readonly emitter: IEventBus = createModuleEventBus('SettingPropEntry');

  // ==== dynamic properties ====
  @obx.ref private _name: string | number;

  get name() {
    return this._name;
  }

  @computed get path() {
    const path = this.parent.path.slice();
    if (this.type === 'field') {
      path.push(this.name);
    }
    return path;
  }

  extraProps: any = {};

  constructor(readonly parent: ISettingEntry | ISettingField, name: string | number, type?: 'field' | 'group') {
    makeObservable(this);
    if (type == null) {
      const c = typeof name === 'string' ? name.slice(0, 1) : '';
      if (c === '#') {
        this.type = 'group';
      } else {
        this.type = 'field';
      }
    } else {
      this.type = type;
    }
    // initial self properties
    this._name = name;
    this.isGroup = this.type === 'group';

    // copy parent static properties
    this.editor = parent.editor;
    this.nodes = parent.nodes;
    this.setters = parent.setters;
    this.componentMeta = parent.componentMeta;
    this.isSameComponent = parent.isSameComponent;
    this.isMultiple = parent.isMultiple;
    this.isSingle = parent.isSingle;
    this.designer = parent.designer;
    this.top = parent.top;
  }

  getId() {
    return this.id;
  }

  setKey(key: string | number) {
    if (this.type !== 'field') {
      return;
    }
    const propName = this.path.join('.');
    let l = this.nodes.length;
    while (l-- > 0) {
      this.nodes[l].getProp(propName, true)!.key = key;
    }
    this._name = key;
  }

  getKey() {
    return this._name;
  }

  remove() {
    if (this.type !== 'field') {
      return;
    }
    const propName = this.path.join('.');
    let l = this.nodes.length;
    while (l-- > 0) {
      this.nodes[l].getProp(propName)?.remove();
    }
  }

  // ====== 当前属性读写 =====

  /**
   * 判断当前属性值是否一致
   * -1 多种值
   * 0 无值
   * 1 类似值，比如数组长度一样
   * 2 单一植
   */
  /* istanbul ignore next */
  @computed get valueState(): number {
    return runInAction(() => {
      if (this.type !== 'field') {
        const { getValue } = this.extraProps;
        return getValue
          ? getValue(this.internalToShellPropEntry(), undefined) === undefined
            ? 0
            : 1
          : 0;
      }
      if (this.nodes.length === 1) {
        return 2;
      }
      const propName = this.path.join('.');
      const first = this.nodes[0].getProp(propName)!;
      let l = this.nodes.length;
      let state = 2;
      while (--l > 0) {
        const next = this.nodes[l].getProp(propName, false);
        const s = first.compare(next);
        if (s > 1) {
          return -1;
        }
        if (s === 1) {
          state = 1;
        }
      }
      if (state === 2 && first.isUnset()) {
        return 0;
      }
      return state;
    });
  }

  /**
   * 获取当前属性值
   */
  getValue(): any {
    let val: any;
    if (this.type === 'field') {
      val = this.parent.getPropValue(this.name);
    }
    const { getValue } = this.extraProps;
    try {
      return getValue ? getValue(this.internalToShellPropEntry(), val) : val;
    } catch (e) {
      console.warn(e);
      return val;
    }
  }

  /**
   * 设置当前属性值
   */
  setValue(val: any, isHotValue?: boolean, force?: boolean, extraOptions?: IPublicTypeSetValueOptions) {
    const oldValue = this.getValue();
    if (this.type === 'field') {
      this.parent.setPropValue(this.name, val);
    }

    const { setValue } = this.extraProps;
    if (setValue && !extraOptions?.disableMutator) {
      try {
        setValue(this.internalToShellPropEntry(), val);
      } catch (e) {
        /* istanbul ignore next */
        console.warn(e);
      }
    }
    this.notifyValueChange(oldValue, val);
    // 如果 fromSetHotValue，那么在 setHotValue 中已经调用过 valueChange 了
    if (!extraOptions?.fromSetHotValue) {
      this.valueChange(extraOptions);
    }
  }

  /**
   * 清除已设置的值
   */
  clearValue() {
    if (this.type === 'field') {
      this.parent.clearPropValue(this.name);
    }
    const { setValue } = this.extraProps;
    if (setValue) {
      try {
        setValue(this.internalToShellPropEntry(), undefined);
      } catch (e) {
        /* istanbul ignore next */
        console.warn(e);
      }
    }
  }

  /**
   * 获取子项
   */
  get(propName: string | number) {
    const path = this.path.concat(propName).join('.');
    return this.top.get(path);
  }

  /**
   * 设置子级属性值
   */
  setPropValue(propName: string | number, value: any) {
    const path = this.path.concat(propName).join('.');
    this.top.setPropValue(path, value);
  }

  /**
   * 清除已设置值
   */
  clearPropValue(propName: string | number) {
    const path = this.path.concat(propName).join('.');
    this.top.clearPropValue(path);
  }

  /**
   * 获取子级属性值
   */
  getPropValue(propName: string | number): any {
    return this.top.getPropValue(this.path.concat(propName).join('.'));
  }

  /**
   * 获取顶层附属属性值
   */
  getExtraPropValue(propName: string) {
    return this.top.getExtraPropValue(propName);
  }

  /**
   * 设置顶层附属属性值
   */
  setExtraPropValue(propName: string, value: any) {
    this.top.setExtraPropValue(propName, value);
  }

  // ======= compatibles for vision ======
  getNode() {
    return this.nodes[0];
  }

  getName(): string {
    return this.path.join('.');
  }

  getProps() {
    return this.top;
  }

  // add settingfield props
  get props() {
    return this.top;
  }

  onValueChange(func: () => any) {
    this.emitter.on('valuechange', func);

    return () => {
      this.emitter.removeListener('valuechange', func);
    };
  }

  /**
   * @deprecated
   */
  valueChange(options: IPublicTypeSetValueOptions = {}) {
    this.emitter.emit('valuechange', options);

    if (this.parent && isSettingField(this.parent)) {
      this.parent.valueChange(options);
    }
  }

  notifyValueChange(oldValue: any, newValue: any) {
    this.editor.eventBus.emit(GlobalEvent.Node.Prop.Change, {
      node: this.getNode(),
      prop: this,
      oldValue,
      newValue,
    });
  }

  getDefaultValue() {
    return this.extraProps.defaultValue;
  }

  isIgnore() {
    return false;
  }

  getVariableValue() {
    const v = this.getValue();
    if (isJSExpression(v)) {
      return v.value;
    }
    return '';
  }

  setVariableValue(value: string) {
    const v = this.getValue();
    this.setValue({
      type: 'JSExpression',
      value,
      mock: isJSExpression(v) ? v.mock : v,
    });
  }

  setUseVariable(flag: boolean) {
    if (this.isUseVariable() === flag) {
      return;
    }
    const v = this.getValue();
    if (this.isUseVariable()) {
      this.setValue(v.mock);
    } else {
      this.setValue({
        type: 'JSExpression',
        value: '',
        mock: v,
      });
    }
  }

  isUseVariable() {
    return isJSExpression(this.getValue());
  }

  get useVariable() {
    return this.isUseVariable();
  }

  getMockOrValue() {
    const v = this.getValue();
    if (isJSExpression(v)) {
      return v.mock;
    }
    return v;
  }

  internalToShellPropEntry() {
    return this.designer.shellModelFactory.createSettingPropEntry(this);
  }
}
