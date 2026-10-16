import { realpath, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { BusinessException } from '../../common/index.js'

/**
 * Canonical key for workspace memory.
 * Existing directories use realpath so two spellings of the same folder match.
 * A path that does not exist yet falls back to its absolute path.
 */
export async function workspaceMemoryKey(dir: string): Promise<string> {
    const trimmed = dir.trim()
    if (!trimmed) throw BusinessException.badRequest('Workspace directory is required')
    const absolute = resolve(trimmed)
    try {
        const info = await stat(absolute)
        if (!info.isDirectory())
            throw BusinessException.badRequest('Workspace path is not a directory')
        return await realpath(absolute)
    } catch (error) {
        if (error instanceof BusinessException) throw error
        return absolute
    }
}
