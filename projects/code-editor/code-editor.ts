import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewEncapsulation,
  booleanAttribute,
  forwardRef,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { indentWithTab } from '@codemirror/commands';
import { LanguageDescription, indentUnit } from '@codemirror/language';
import { Annotation, Compartment, EditorState, Extension, StateEffect } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, highlightWhitespace, keymap, placeholder } from '@codemirror/view';
import { basicSetup, minimalSetup } from 'codemirror';

export type Theme = 'light' | 'dark' | Extension;
export type Setup = 'basic' | 'minimal' | null;

const External = Annotation.define<boolean>();

@Component({
  selector: 'code-editor',
  standalone: true,
  template: ``,
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CodeEditor),
      multi: true,
    },
  ],
})
export class CodeEditor implements OnInit, OnDestroy, ControlValueAccessor {
  /**
   * The document or shadow [root](https://codemirror.net/docs/ref/#view.EditorView.root)
   * that the view lives in.
   */
  @Input() root?: Document | ShadowRoot;

  /** Whether focus on the editor when init. */
  @Input({ transform: booleanAttribute }) autoFocus = false;

  /** Editor's value. */
  @Input()
  get value() {
    return this._value;
  }
  set value(newValue: string) {
    this._value = newValue;
    this.setValue(newValue);
  }
  private _value = '';

  /** Editor's theme. */
  @Input()
  get theme() {
    return this._theme;
  }
  set theme(value: Theme) {
    this._theme = value;
    this._dispatchEffects(
      this._themeConf.reconfigure(value === 'light' ? [] : value === 'dark' ? oneDark : value)
    );
  }
  private _theme: Theme = 'light';

  /** Editor's placecholder. */
  @Input()
  get placeholder() {
    return this._placeholder;
  }
  set placeholder(value: string) {
    this._placeholder = value;
    this._dispatchEffects(this._placeholderConf.reconfigure(value ? placeholder(value) : []));
  }
  private _placeholder = '';

  /** Whether the editor is disabled.  */
  @Input({ transform: booleanAttribute }) disabled = false;

  /** Whether the editor is readonly. */
  @Input({ transform: booleanAttribute })
  get readonly() {
    return this._readonly;
  }
  set readonly(value: boolean) {
    this._readonly = value;
    this._dispatchEffects(this._readonlyConf.reconfigure(EditorState.readOnly.of(value)));
  }
  private _readonly = false;

  /** A binding that binds Tab to indentMore and Shift-Tab to indentLess. */
  @Input({ transform: booleanAttribute })
  get indentWithTab() {
    return this._indentWithTab;
  }
  set indentWithTab(value: boolean) {
    this._indentWithTab = value;
    this._dispatchEffects(
      this._indentWithTabConf.reconfigure(value ? keymap.of([indentWithTab]) : [])
    );
  }
  private _indentWithTab = false;

  /** Should be a string consisting either entirely of the same whitespace character. */
  @Input()
  get indentUnit() {
    return this._indentUnit;
  }
  set indentUnit(value: string) {
    this._indentUnit = value;
    this._dispatchEffects(this._indentUnitConf.reconfigure(value ? indentUnit.of(value) : []));
  }
  private _indentUnit = '';

  /** Whether this editor wraps lines. */
  @Input({ transform: booleanAttribute })
  get lineWrapping() {
    return this._lineWrapping;
  }
  set lineWrapping(value: boolean) {
    this._lineWrapping = value;
    this._dispatchEffects(this._lineWrappingConf.reconfigure(value ? EditorView.lineWrapping : []));
  }
  private _lineWrapping = false;

  /** Whether highlight the whitespace. */
  @Input({ transform: booleanAttribute })
  get highlightWhitespace() {
    return this._highlightWhitespace;
  }
  set highlightWhitespace(value: boolean) {
    this._highlightWhitespace = value;
    this._dispatchEffects(
      this._highlightWhitespaceConf.reconfigure(value ? highlightWhitespace() : [])
    );
  }
  private _highlightWhitespace = false;

  /**
   * An array of language descriptions for known
   * [language-data packages](https://github.com/codemirror/language-data/blob/main/src/language-data.ts).
   */
  @Input() languages: LanguageDescription[] = [];

  /** Editor's language. You should set the `languages` prop at first. */
  @Input()
  get language() {
    return this._language;
  }
  set language(value: string) {
    this._language = value;
    this.setLanguage(value);
  }
  private _language = '';

  /**
   * The editor's built-in setup. The value can be set to
   * [`basic`](https://codemirror.net/docs/ref/#codemirror.basicSetup),
   * [`minimal`](https://codemirror.net/docs/ref/#codemirror.minimalSetup) or `null`.
   */
  @Input()
  get setup() {
    return this._setup;
  }
  set setup(value: Setup) {
    this._setup = value;
    this.reconfigure();
  }
  private _setup: Setup = 'basic';

  /**
   * EditorState's [extensions](https://codemirror.net/docs/ref/#state.EditorStateConfig.extensions).
   */
  @Input()
  get extensions() {
    return this._extensions;
  }
  set extensions(value: Extension[]) {
    this._extensions = value;
    this.reconfigure();
  }
  private _extensions: Extension[] = [];

  /** Event emitted when the editor's value changes. */
  @Output() change = new EventEmitter<string>();

  /** Event emitted when focus on the editor. */
  @Output() focus = new EventEmitter<void>();

  /** Event emitted when the editor has lost focus. */
  @Output() blur = new EventEmitter<void>();

  view?: EditorView;

  private _onChange: (value: string) => void = () => {};
  private _onTouched: () => void = () => {};

  constructor(private _elementRef: ElementRef<Element>) {}

  private _updateListener = EditorView.updateListener.of(vu => {
    if (vu.docChanged && !vu.transactions.some(tr => tr.annotation(External))) {
      const value = vu.state.doc.toString();
      this._onChange(value);
      this.change.emit(value);
    }
  });

  // Extension compartments can be used to make a configuration dynamic.
  // https://codemirror.net/docs/ref/#state.Compartment
  private _themeConf = new Compartment();
  private _placeholderConf = new Compartment();
  private _disabledConf = new Compartment();
  private _readonlyConf = new Compartment();
  private _indentWithTabConf = new Compartment();
  private _indentUnitConf = new Compartment();
  private _lineWrappingConf = new Compartment();
  private _highlightWhitespaceConf = new Compartment();
  private _languageConf = new Compartment();

  private _getExtensions(): Extension[] {
    return [
      this._updateListener,

      this._themeConf.of([]),
      this._placeholderConf.of([]),
      this._disabledConf.of([]),
      this._readonlyConf.of([]),
      this._indentWithTabConf.of([]),
      this._indentUnitConf.of([]),
      this._lineWrappingConf.of([]),
      this._highlightWhitespaceConf.of([]),
      this._languageConf.of([]),

      this.setup === 'basic' ? basicSetup : this.setup === 'minimal' ? minimalSetup : [],

      ...this.extensions,
    ];
  }

  private _dispatchEffects(effects: StateEffect<any> | readonly StateEffect<any>[]) {
    return this.view?.dispatch({ effects });
  }

  reconfigure() {
    this._dispatchEffects(StateEffect.reconfigure.of(this._getExtensions()));
  }

  setValue(value: string) {
    this.view?.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: value },
    });
  }

  /** Sets language dynamically. */
  setLanguage(lang: string, onInit?: boolean) {
    if (!lang) {
      return;
    }
    if (this.languages.length === 0) {
      onInit && console.error('No supported languages. Please set the languages prop at first.');
      return;
    }
    const langDesc = this.findLanguage(lang);
    langDesc?.load().then(lang => {
      this._dispatchEffects(this._languageConf.reconfigure([lang]));
    });
  }

  /** Find the language's extension by its name. Case insensitive. */
  findLanguage(name: string) {
    for (const lang of this.languages) {
      for (const alias of [lang.name, ...lang.alias]) {
        if (name.toLowerCase() === alias.toLowerCase()) {
          return lang;
        }
      }
    }
    console.error('Language not found:', name);
    console.info('Supported language names:', this.languages.map(lang => lang.name).join(', '));
    return null;
  }

  ngOnInit(): void {
    this.view = new EditorView({
      root: this.root,
      parent: this._elementRef.nativeElement,
      state: EditorState.create({
        doc: this.value,
        extensions: this._getExtensions(),
      }),
    });

    if (this.autoFocus) {
      this.view?.focus();
    }

    this.view?.contentDOM.addEventListener('focus', () => {
      this._onTouched();
      this.focus.emit();
    });

    this.view?.contentDOM.addEventListener('blur', () => {
      this._onTouched();
      this.blur.emit();
    });

    // Force setter to be called after editor initialized.
    this.theme = this._theme;
    this.placeholder = this._placeholder;
    this.readonly = this._readonly;
    this.indentWithTab = this._indentWithTab;
    this.indentUnit = this._indentUnit;
    this.lineWrapping = this._lineWrapping;
    this.highlightWhitespace = this._highlightWhitespace;
    this.setDisabledState(this.disabled);
    this.setLanguage(this.language, true);
  }

  ngOnDestroy(): void {
    this.view?.destroy();
  }

  writeValue(value: string): void {
    if (this.view) {
      this.setValue(value);
    }
  }

  registerOnChange(fn: (value: string) => void) {
    this._onChange = fn;
  }

  registerOnTouched(fn: () => void) {
    this._onTouched = fn;
  }

  setDisabledState(isDisabled: boolean) {
    this.disabled = isDisabled;
    this._dispatchEffects(this._disabledConf.reconfigure(EditorView.editable.of(!isDisabled)));
  }
}
