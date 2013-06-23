# FamilySearch API

## FS

### getMeta()

Load the endpoints from the [Discovery
resource](https://familysearch.org/developers/docs/api/discovery/Discovery_resource).
These are then cached.

### get(resource, options, token, next)

Example with the [person resource](https://familysearch.org/developers/docs/api/tree/Person_Get_usecase)
and the [person with relationships resource](https://familysearch.org/developers/docs/api/tree/Person_With_Relationships_usecase):

    fs.get('person-template', {pid: 'SOME-PID'}, 'U-token@example.com', function (err, data) {
      if (err) throw err;
      data.persons.forEach(function (person) {
        console.log('Got person', person.display.name);
      });
    }).get('person-with-relationships-query', {person: 'SOME-PID'}, 'U-token@example.com', function (err, data) {
      if (err) throw err;
      data.childAndParentsRelationships.forEach(function (rel) {
        console.log('Father:', rel.father && rel.father.resourceId);
      });
    });

