import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

export interface JSONResult {
    framework: string, keyed: boolean, benchmark: string, type: string, min: number,
        max: number, mean: number, geometricMean: number,
        standardDeviation: number, median: number, values: Array<number>
}

export interface BenchmarkError {
    imageFile : string;
    exception : string
}

export interface ErrorsAndWarning {
    errors: BenchmarkError[];
    warnings: String[];
}

export interface BenchmarkDriverOptions {
    headless?: boolean;
    chromeBinaryPath?: string;
    remoteDebuggingPort: number;
    chromePort: number;
}

export interface BenchmarkOptions extends BenchmarkDriverOptions {
    outputDirectory: string;
    port: string;
    numIterationsForCPUBenchmarks: number;
    numIterationsForMemBenchmarks: number;
    numIterationsForStartupBenchmark: number;
}

export let config = {
    PORT: 8080,
    REMOTE_DEBUGGING_PORT: 9999,
    CHROME_PORT: 9998,
    REPEAT_RUN: 10,
    REPEAT_RUN_MEM: 5,
    REPEAT_RUN_STARTUP: 4,
    DROP_WORST_RUN: 0,
    WARMUP_COUNT: 5,
    TIMEOUT: 60 * 1000,
    LOG_PROGRESS: true,
    LOG_DETAILS: false,
    LOG_DEBUG: false,
    LOG_TIMELINE: false,
    EXIT_ON_ERROR: false,
    STARTUP_DURATION_FROM_EVENTLOG: true,
    STARTUP_SLEEP_DURATION: 1000,
    FORK_CHROMEDRIVER: true,
    WRITE_RESULTS: true
}
export type TConfig = typeof config;

export interface FrameworkData {
    name: string;
    fullNameWithKeyedAndVersion: string;
    uri: string;
    keyed: boolean;
    useShadowRoot: boolean;
}

interface Options {
    uri: string;
    useShadowRoot? : boolean;
}

type KeyedType = 'keyed' | 'non-keyed';

function computeHash(keyedType: KeyedType, directory: string) {
    return keyedType+'/'+directory;
}

export interface FrameworkId {
    keyedType: KeyedType;
    directory: string;
}


abstract class FrameworkVersionInformationValid implements FrameworkId {
    public url: string;
    constructor(public keyedType: KeyedType, public directory: string, customURL: string|undefined, public useShadowRoot: boolean) {
        this.keyedType = keyedType;
        this.directory = directory;
        this.url = 'frameworks/'+keyedType+'/'+directory + (customURL ? customURL : '');
    }
}

export class FrameworkVersionInformationDynamic extends FrameworkVersionInformationValid  {
    constructor(keyedType: KeyedType, directory: string, public packageNames: string[],
        customURL: string|undefined, useShadowRoot: boolean = false) {
            super(keyedType, directory, customURL, useShadowRoot);
        }
    }

export class FrameworkVersionInformationStatic extends FrameworkVersionInformationValid  {
    constructor(keyedType: KeyedType, directory: string, public frameworkVersion: string, customURL: string|undefined, useShadowRoot: boolean = false) {
        super(keyedType, directory, customURL, useShadowRoot);
    }
    getFrameworkData(): FrameworkData {
        return {name: this.directory,
            fullNameWithKeyedAndVersion: this.directory+(this.frameworkVersion ? '-v'+this.frameworkVersion : '')+'-'+this.keyedType,
            uri: this.url,
            keyed: this.keyedType === 'keyed',
            useShadowRoot: this.useShadowRoot
        }
    }
}

export class FrameworkVersionInformationError implements FrameworkId  {
    constructor(public keyedType: KeyedType, public directory: string, public error: string) {}
}

export type FrameworkVersionInformation = FrameworkVersionInformationDynamic | FrameworkVersionInformationStatic | FrameworkVersionInformationError;

export class PackageVersionInformationValid {
    constructor(public packageName: string, public version: string) {}
}

export class PackageVersionInformationErrorUnknownPackage  {
    constructor(public packageName: string) {}
}

export class PackageVersionInformationErrorNoPackageJSONLock  {
    constructor() {}
}

export type PackageVersionInformation = PackageVersionInformationValid | PackageVersionInformationErrorUnknownPackage | PackageVersionInformationErrorNoPackageJSONLock;

export interface IMatchPredicate {
    (frameworkDirectory: string): boolean
}

const matchAll : IMatchPredicate= (frameworkDirectory: string) => true;

export function loadFrameworkVersionInformation(matchPredicate: IMatchPredicate = matchAll): FrameworkVersionInformation[] {
    let result = new Array<FrameworkVersionInformation>();
    let frameworksPath = path.resolve('..','frameworks');
    ['keyed','non-keyed'].forEach((keyedType: KeyedType) => {
        let directories = fs.readdirSync(path.resolve(frameworksPath, keyedType));

        for (let directory of directories) {
            let frameworkPath = path.join(keyedType, directory);
            if (matchPredicate(frameworkPath)) {
                let packageJSONPath = path.resolve(frameworksPath, frameworkPath, 'package.json');
                if (fs.existsSync(packageJSONPath)) {
                    let packageJSON = JSON.parse(fs.readFileSync(packageJSONPath, 'utf8'));
                    if (packageJSON['js-framework-benchmark']) {
                        if (packageJSON['js-framework-benchmark']['frameworkVersionFromPackage']) {
                            result.push(new FrameworkVersionInformationDynamic(keyedType, directory,
                                packageJSON['js-framework-benchmark']['frameworkVersionFromPackage'].split(':'),
                                packageJSON['js-framework-benchmark']['customURL'],
                                packageJSON['js-framework-benchmark']['useShadowRoot']
                            ));
                        } else if (typeof packageJSON['js-framework-benchmark']['frameworkVersion'] === 'string') {
                            result.push(new FrameworkVersionInformationStatic(keyedType, directory,
                                packageJSON['js-framework-benchmark']['frameworkVersion'],
                                packageJSON['js-framework-benchmark']['customURL'],
                                packageJSON['js-framework-benchmark']['useShadowRoot']
                            ));
                        } else {
                            result.push(new FrameworkVersionInformationError(keyedType, directory, 'package.json must contain a \'frameworkVersionFromPackage\' or \'frameworkVersion\' in the \'js-framework-benchmark\'.property'));
                        }
                    } else {
                        result.push(new FrameworkVersionInformationError(keyedType, directory, 'package.json must contain a \'js-framework-benchmark\' property'));
                    }
                } else {
                    result.push(new FrameworkVersionInformationError(keyedType, directory, 'No package.json found'));
                }
            }
        }
    });
    return result;
}

export class PackageVersionInformationResult {
    public versions: Array<PackageVersionInformation> = [];
    constructor(public framework: FrameworkVersionInformationDynamic) {}
    public add(packageVersionInformation: PackageVersionInformation) {
        this.versions.push(packageVersionInformation);
    }
    public getVersionName(): string {
        if (this.versions.filter(pi => pi instanceof PackageVersionInformationErrorNoPackageJSONLock).length>0) {
            return "invalid (no package-lock)";
        }
        return this.versions.map(version => (version instanceof PackageVersionInformationValid) ? version.version : 'invalid').join(' + ');
    }
    getFrameworkData(): FrameworkData {
        return {name: this.framework.directory,
            fullNameWithKeyedAndVersion: this.framework.directory+'-v'+this.getVersionName()+'-'+this.framework.keyedType,
            uri: this.framework.url,
            keyed: this.framework.keyedType === 'keyed',
            useShadowRoot: this.framework.useShadowRoot
        }
    }
}

export async function determineInstalledVersions(framework: FrameworkVersionInformationDynamic): Promise<PackageVersionInformationResult> {

    let versions = new PackageVersionInformationResult(framework);
    try {
        console.log(`http://localhost:${config.PORT}/frameworks/${framework.keyedType}/${framework.directory}/package-lock.json`)
        let packageLock: any = (await axios.get(`http://localhost:${config.PORT}/frameworks/${framework.keyedType}/${framework.directory}/package-lock.json`)).data;
        for (let packageName of framework.packageNames) {
            if (packageLock.dependencies[packageName]) {
                versions.add(new PackageVersionInformationValid(packageName, packageLock.dependencies[packageName].version));
            } else {
                versions.add(new PackageVersionInformationErrorUnknownPackage(packageName));
            }
        }
    } catch (err) {
        if (err.errno==='ECONNREFUSED') {
            console.log("Can't load package-lock.json via http. Make sure the http-server is running on port 8080");
            throw "Can't load package-lock.json via http. Make sure the http-server is running on port 8080";
        } else if (err.response && err.response.status === 404) {
            console.log(`package-lock.json not found for ${framework.keyedType}/${framework.directory}`);
            versions.add(new PackageVersionInformationErrorNoPackageJSONLock());
        } else {
            console.log("err", err);
            versions.add(new PackageVersionInformationErrorNoPackageJSONLock());
        }
    }
    return versions;
}

export async function initializeFrameworks(matchPredicate: IMatchPredicate = matchAll): Promise<FrameworkData[]> {
    let frameworkVersionInformations = loadFrameworkVersionInformation(matchPredicate);

    let frameworks: FrameworkData[] = [];
    for (let frameworkVersionInformation of frameworkVersionInformations) {
        if (frameworkVersionInformation instanceof FrameworkVersionInformationDynamic) {
            frameworks.push((await determineInstalledVersions(frameworkVersionInformation)).getFrameworkData());
        } else if (frameworkVersionInformation instanceof FrameworkVersionInformationStatic) {
            frameworks.push(frameworkVersionInformation.getFrameworkData());
        } else {
            console.log(`WARNING: Ignoring package ${frameworkVersionInformation.keyedType}/${frameworkVersionInformation.directory}: ${frameworkVersionInformation.error}`)
            frameworks.push(null);
        }
    }

    frameworks = frameworks.filter(f => f!==null);
    if (config.LOG_DETAILS) {
        console.log("All available frameworks: ");
        console.log(frameworks.map(fd => fd.fullNameWithKeyedAndVersion));
    }
    return frameworks;
}
