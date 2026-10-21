export function projectName(project: string): string {
  return project.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || project;
}
