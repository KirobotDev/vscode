/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry, IWorkbenchContribution } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { hasWorkspaceFileExtension, IWorkspaceContextService, WorkbenchState, WORKSPACE_SUFFIX, isWorkspaceIdentifier, isSingleFolderWorkspaceIdentifier } from '../../../../platform/workspace/common/workspace.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWindowOpenable, IFolderToOpen, IWorkspaceToOpen } from '../../../../platform/window/common/window.js';
import { INeverShowAgainOptions, INotificationService, NeverShowAgainScope, NotificationPriority, Severity } from '../../../../platform/notification/common/notification.js';
import { URI } from '../../../../base/common/uri.js';
import { isEqual, joinPath } from '../../../../base/common/resources.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IQuickInputService, IQuickPickItem, IQuickInputButton } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { isVirtualWorkspace } from '../../../../platform/workspace/common/virtualWorkspace.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { ActiveEditorContext, ResourceContextKey, TemporaryWorkspaceContext } from '../../../common/contextkeys.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { TEXT_FILE_EDITOR_ID } from '../../files/common/files.js';
import { IWorkspacesService, IRecent, isRecentFolder, isRecentWorkspace } from '../../../../platform/workspaces/common/workspaces.js';
import { ILabelService, Verbosity } from '../../../../platform/label/common/label.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { getIconClasses } from '../../../../editor/common/services/getIconClasses.js';
import { FileKind } from '../../../../platform/files/common/files.js';
import { splitRecentLabel } from '../../../../base/common/labels.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { ResourceMap } from '../../../../base/common/map.js';

/**
 * A workbench contribution that will look for `.code-workspace` files in the root of the
 * workspace folder and open a notification to suggest to open one of the workspaces.
 */
export class WorkspacesFinderContribution extends Disposable implements IWorkbenchContribution {

	constructor(
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@INotificationService private readonly notificationService: INotificationService,
		@IFileService private readonly fileService: IFileService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IHostService private readonly hostService: IHostService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();

		this.findWorkspaces();
	}

	private async findWorkspaces(): Promise<void> {
		const folder = this.contextService.getWorkspace().folders[0];
		if (!folder || this.contextService.getWorkbenchState() !== WorkbenchState.FOLDER || isVirtualWorkspace(this.contextService.getWorkspace())) {
			return; // require a single (non virtual) root folder
		}

		const rootFileNames = (await this.fileService.resolve(folder.uri)).children?.map((child: { name: string }) => child.name);
		if (Array.isArray(rootFileNames)) {
			const workspaceFiles = rootFileNames.filter(hasWorkspaceFileExtension);
			if (workspaceFiles.length > 0) {
				this.doHandleWorkspaceFiles(folder.uri, workspaceFiles);
			}
		}
	}

	private doHandleWorkspaceFiles(folder: URI, workspaces: string[]): void {
		const neverShowAgain: INeverShowAgainOptions = { id: 'workspaces.dontPromptToOpen', scope: NeverShowAgainScope.WORKSPACE, isSecondary: true };

		// Prompt to open one workspace
		if (workspaces.length === 1) {
			const workspaceFile = workspaces[0];

			this.notificationService.prompt(Severity.Info, localize(
				{
					key: 'foundWorkspace',
					comment: ['{Locked="]({1})"}']
				},
				"This folder contains a workspace file '{0}'. Do you want to open it? [Learn more]({1}) about workspace files.",
				workspaceFile,
				'https://go.microsoft.com/fwlink/?linkid=2025315'
			), [{
				label: localize('openWorkspace', "Open Workspace"),
				run: () => this.hostService.openWindow([{ workspaceUri: joinPath(folder, workspaceFile) }])
			}], {
				neverShowAgain,
				priority: !this.storageService.isNew(StorageScope.WORKSPACE) ? NotificationPriority.SILENT : NotificationPriority.OPTIONAL // https://github.com/microsoft/vscode/issues/125315
			});
		}

		// Prompt to select a workspace from many
		else if (workspaces.length > 1) {
			this.notificationService.prompt(Severity.Info, localize({
				key: 'foundWorkspaces',
				comment: ['{Locked="]({0})"}']
			}, "This folder contains multiple workspace files. Do you want to open one? [Learn more]({0}) about workspace files.", 'https://go.microsoft.com/fwlink/?linkid=2025315'), [{
				label: localize('selectWorkspace', "Select Workspace"),
				run: () => {
					this.quickInputService.pick(
						workspaces.map(workspace => ({ label: workspace } satisfies IQuickPickItem)),
						{ placeHolder: localize('selectToOpen', "Select a workspace to open") }).then(pick => {
							if (pick) {
								this.hostService.openWindow([{ workspaceUri: joinPath(folder, pick.label) }]);
							}
						});
				}
			}], {
				neverShowAgain,
				priority: !this.storageService.isNew(StorageScope.WORKSPACE) ? NotificationPriority.SILENT : NotificationPriority.OPTIONAL // https://github.com/microsoft/vscode/issues/125315
			});
		}
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(WorkspacesFinderContribution, LifecyclePhase.Eventually);

// Render "Open Workspace" button in *.code-workspace files

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.openWorkspaceFromEditor',
			title: localize2('openWorkspace', "Open Workspace"),
			f1: false,
			menu: {
				id: MenuId.EditorContent,
				when: ContextKeyExpr.and(
					ResourceContextKey.Extension.isEqualTo(WORKSPACE_SUFFIX),
					ActiveEditorContext.isEqualTo(TEXT_FILE_EDITOR_ID),
					TemporaryWorkspaceContext.toNegated()
				)
			}
		});
	}

	async run(accessor: ServicesAccessor, uri: URI): Promise<void> {
		const hostService = accessor.get(IHostService);
		const contextService = accessor.get(IWorkspaceContextService);
		const notificationService = accessor.get(INotificationService);

		if (contextService.getWorkbenchState() === WorkbenchState.WORKSPACE) {
			const workspaceConfiguration = contextService.getWorkspace().configuration;
			if (workspaceConfiguration && isEqual(workspaceConfiguration, uri)) {
				notificationService.info(localize('alreadyOpen', "This workspace is already open."));

				return; // workspace already opened
			}
		}

		return hostService.openWindow([{ workspaceUri: uri }]);
	}
});

// Quick Switch Workspace - IntelliJ Style
interface IWorkspaceQuickPickItem extends IQuickPickItem {
	workspace: IRecent;
	openable: IWindowOpenable;
	remoteAuthority?: string;
}

class QuickSwitchWorkspaceAction extends Action2 {
	static readonly ID = 'workbench.action.quickSwitchWorkspace';

	constructor() {
		super({
			id: QuickSwitchWorkspaceAction.ID,
			title: {
				...localize2('quickSwitchWorkspace', "Quick Switch Workspace"),
				mnemonicTitle: localize({ key: 'miQuickSwitchWorkspace', comment: ['&& denotes a mnemonic'] }, "Quick Switch &&Workspace"),
			},
			category: Categories.File,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.Backquote, // Ctrl+` comme IntelliJ
				mac: { primary: KeyMod.WinCtrl | KeyCode.Backquote }
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const workspacesService = accessor.get(IWorkspacesService);
		const quickInputService = accessor.get(IQuickInputService);
		const contextService = accessor.get(IWorkspaceContextService);
		const labelService = accessor.get(ILabelService);
		const modelService = accessor.get(IModelService);
		const languageService = accessor.get(ILanguageService);
		const hostService = accessor.get(IHostService);

		const [recentlyOpened, mainWindows] = await Promise.all([
			workspacesService.getRecentlyOpened(),
			hostService.getWindows({ includeAuxiliaryWindows: false })
		]);

		const openedWorkspaces = new ResourceMap<{ windowId: number }>();
		for (const window of mainWindows) {
			if (isSingleFolderWorkspaceIdentifier(window.workspace)) {
				openedWorkspaces.set(window.workspace.uri, { windowId: window.id });
			} else if (isWorkspaceIdentifier(window.workspace)) {
				openedWorkspaces.set(window.workspace.configPath, { windowId: window.id });
			}
		}

		const currentWorkspace = contextService.getWorkspace();
		let currentWorkspaceUri: URI | undefined;
		if (currentWorkspace.configuration) {
			currentWorkspaceUri = currentWorkspace.configuration;
		} else if (currentWorkspace.folders.length === 1) {
			currentWorkspaceUri = currentWorkspace.folders[0].uri;
		}

		const workspacePicks: IWorkspaceQuickPickItem[] = [];
		for (const recent of recentlyOpened.workspaces) {
			const item = this.createWorkspaceItem(modelService, languageService, labelService, recent, openedWorkspaces, currentWorkspaceUri);
			if (item) {
				workspacePicks.push(item);
			}
		}

		if (workspacePicks.length === 0) {
			return;
		}

		const pick = await quickInputService.pick(workspacePicks, {
			placeHolder: localize('quickSwitchWorkspacePlaceholder', "Select workspace to switch to (Ctrl+` to cycle)"),
			matchOnDescription: true,
			sortByLabel: false,
			ignoreFocusLost: true
		});

		if (pick && pick.openable) {
			hostService.openWindow([pick.openable], {
				remoteAuthority: pick.remoteAuthority || null
			});
		}
	}

	private createWorkspaceItem(
		modelService: IModelService,
		languageService: ILanguageService,
		labelService: ILabelService,
		recent: IRecent,
		openedWorkspaces: ResourceMap<{ windowId: number }>,
		currentWorkspaceUri?: URI
	): IWorkspaceQuickPickItem | undefined {
		let openable: IWindowOpenable | undefined;
		let iconClasses: string[];
		let fullLabel: string | undefined;
		let resource: URI | undefined;

		if (isRecentFolder(recent)) {
			resource = recent.folderUri;
			if (currentWorkspaceUri && resource.toString() === currentWorkspaceUri.toString()) {
				return undefined;
			}
			iconClasses = getIconClasses(modelService, languageService, resource, FileKind.FOLDER);
			openable = { folderUri: resource } as IFolderToOpen;
			fullLabel = recent.label || labelService.getWorkspaceLabel(resource, { verbose: Verbosity.LONG });
		}
		else if (isRecentWorkspace(recent)) {
			resource = recent.workspace.configPath;
			if (currentWorkspaceUri && resource.toString() === currentWorkspaceUri.toString()) {
				return undefined;
			}
			iconClasses = getIconClasses(modelService, languageService, resource, FileKind.ROOT_FOLDER);
			openable = { workspaceUri: resource } as IWorkspaceToOpen;
			fullLabel = recent.label || labelService.getWorkspaceLabel(recent.workspace, { verbose: Verbosity.LONG });
		} else {
			return undefined;
		}

		const { name, parentPath } = splitRecentLabel(fullLabel);

		const isOpen = openedWorkspaces.has(resource);
		const buttons: IQuickInputButton[] = [];
		if (isOpen) {
			buttons.push({
				iconClass: ThemeIcon.asClassName(Codicon.window),
				tooltip: localize('workspaceOpen', "Already open in another window")
			});
		}

		return {
			iconClasses,
			label: name,
			description: parentPath,
			ariaLabel: isOpen ? localize('workspaceOpenAria', "{0} (already open)", name) : name,
			buttons,
			workspace: recent,
			openable,
			remoteAuthority: recent.remoteAuthority
		};
	}
}

registerAction2(QuickSwitchWorkspaceAction);

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	group: '2_open',
	command: {
		id: QuickSwitchWorkspaceAction.ID,
		title: localize({ key: 'miQuickSwitchWorkspace', comment: ['&& denotes a mnemonic'] }, "Quick Switch &&Workspace")
	},
});
